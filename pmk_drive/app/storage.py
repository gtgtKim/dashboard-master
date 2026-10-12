"""Opaque object keys; file names and directory structure live only in SQLite."""
import hashlib
import os
import shutil
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


class LocalStorage:
    def __init__(self, root):
        self.root = Path(root)
        (self.root / "objects").mkdir(parents=True, exist_ok=True)
        (self.root / "parts").mkdir(exist_ok=True)

    def start(self, key, mime):
        (self.root / "parts" / key).mkdir(exist_ok=True)
        return key

    def part_path(self, key, number):
        return self.root / "parts" / key / str(number)

    def parts(self, key, upload_id):
        folder = self.root / "parts" / key
        return sorted([{"PartNumber": int(p.name), "Size": p.stat().st_size,
                        "ETag": p.name} for p in folder.glob("*") if p.name.isdigit()],
                      key=lambda p: p["PartNumber"])

    def exists(self, key, size):
        p = self.root / "objects" / key
        return p.exists() and p.stat().st_size == size

    def finish(self, key, upload_id, parts):
        target = self.root / "objects" / key
        temporary = target.with_suffix(".tmp")
        with temporary.open("wb") as out:
            for part in parts:
                with self.part_path(key, part["PartNumber"]).open("rb") as source:
                    shutil.copyfileobj(source, out, length=1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        temporary.replace(target)
        shutil.rmtree(self.root / "parts" / key, ignore_errors=True)

    def abort(self, key, upload_id):
        shutil.rmtree(self.root / "parts" / key, ignore_errors=True)


class S3Storage:
    def __init__(self, settings):
        self.bucket = settings.bucket
        self.client = boto3.client(
            "s3", endpoint_url=settings.endpoint or None,
            region_name=settings.region,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3},
                          s3={"addressing_style": settings.addressing_style}))

    @staticmethod
    def object_key(key):
        return "pmk-drive/" + key

    def start(self, key, mime):
        return self.client.create_multipart_upload(
            Bucket=self.bucket, Key=self.object_key(key), ContentType=mime)["UploadId"]

    def parts(self, key, upload_id):
        result = []
        paginator = self.client.get_paginator("list_parts")
        for page in paginator.paginate(Bucket=self.bucket, Key=self.object_key(key), UploadId=upload_id):
            result.extend(page.get("Parts", []))
        return sorted(result, key=lambda p: p["PartNumber"])

    def exists(self, key, size):
        try:
            return self.client.head_object(Bucket=self.bucket, Key=self.object_key(key))["ContentLength"] == size
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def sign_part(self, key, upload_id, number, size):
        return self.client.generate_presigned_url("upload_part", Params={
            "Bucket": self.bucket, "Key": self.object_key(key), "UploadId": upload_id,
            "PartNumber": number, "ContentLength": size}, ExpiresIn=900)

    def finish(self, key, upload_id, parts):
        self.client.complete_multipart_upload(Bucket=self.bucket, Key=self.object_key(key),
            UploadId=upload_id, MultipartUpload={"Parts": [
                {"PartNumber": p["PartNumber"], "ETag": p["ETag"]} for p in parts]})

    def abort(self, key, upload_id):
        try:
            self.client.abort_multipart_upload(Bucket=self.bucket, Key=self.object_key(key), UploadId=upload_id)
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "NoSuchUpload":
                raise

    def download(self, key, name):
        return self.client.generate_presigned_url("get_object", Params={
            "Bucket": self.bucket, "Key": self.object_key(key),
            "ResponseContentType": "application/octet-stream",
            "ResponseContentDisposition": "attachment; filename*=UTF-8''" + quote(name, safe="")}, ExpiresIn=60)


class GCSStorage:
    """Browser uploads signed parts; GCS composes them without VM file traffic."""
    def __init__(self, settings):
        from google.cloud import storage
        self.client = storage.Client()
        self.bucket = self.client.bucket(settings.bucket)

    def start(self, key, mime):
        return key

    def part_key(self, key, number):
        return f"pmk-drive/_uploads/{key}/{number}"

    def parts(self, key, upload_id):
        prefix = f"pmk-drive/_uploads/{key}/"
        result = []
        for blob in self.client.list_blobs(self.bucket, prefix=prefix):
            suffix = blob.name[len(prefix):]
            if suffix.isdigit():
                result.append({"PartNumber": int(suffix), "Size": blob.size,
                               "ETag": str(blob.generation)})
        return sorted(result, key=lambda p: p["PartNumber"])

    def exists(self, key, size):
        blob = self.bucket.get_blob("pmk-drive/" + key)
        return blob is not None and blob.size == size

    def sign_part(self, key, upload_id, number, size):
        from datetime import timedelta
        return self.bucket.blob(self.part_key(key, number)).generate_signed_url(
            version="v4", expiration=timedelta(minutes=15), method="PUT",
            headers={"Content-Length": str(size)})

    def finish(self, key, upload_id, parts):
        sources = [self.bucket.blob(self.part_key(key, p["PartNumber"]),
                                  generation=int(p["ETag"])) for p in parts]
        level = 0
        while len(sources) > 32:
            next_sources = []
            for offset in range(0, len(sources), 32):
                target = self.bucket.blob(f"pmk-drive/_uploads/{key}/compose-{level}-{offset}")
                group = sources[offset:offset + 32]
                target.compose(group, if_source_generation_match=[b.generation for b in group])
                next_sources.append(target)
            sources = next_sources
            level += 1
        target = self.bucket.blob("pmk-drive/" + key)
        target.content_type = "application/octet-stream"
        target.compose(sources, if_generation_match=0,
                       if_source_generation_match=[b.generation for b in sources])
        self.abort(key, upload_id)

    def abort(self, key, upload_id):
        for blob in self.client.list_blobs(self.bucket, prefix=f"pmk-drive/_uploads/{key}/"):
            blob.delete(if_generation_match=blob.generation)

    def download(self, key, name):
        from datetime import timedelta
        return self.bucket.blob("pmk-drive/" + key).generate_signed_url(
            version="v4", expiration=timedelta(seconds=60), method="GET",
            response_type="application/octet-stream",
            response_disposition="attachment; filename*=UTF-8''" + quote(name, safe=""))
