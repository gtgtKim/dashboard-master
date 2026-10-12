import hashlib
import time
from urllib.parse import urlsplit

import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from app.main import Settings, create_app

PASSWORD = 'test-password-12345'
BASE = '/pmk_drive/api'


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, admin_password=PASSWORD, app_url='http://testserver/pmk_drive'))
    with TestClient(app, headers={'X-PMK-Request': '1'}) as c:
        assert c.post(BASE+'/login', json={'username':'admin','password':PASSWORD}).status_code == 200
        yield c


def folder(c, name, parent=None):
    r=c.post(BASE+'/folders',json={'name':name,'parent_id':parent})
    assert r.status_code==201,r.text
    return r.json()['id']


def begin(c, name, content, parent=None):
    r=c.post(BASE+'/uploads',json={'name':name,'size':len(content),'fingerprint':hashlib.sha256(content).hexdigest(),'parent_id':parent})
    assert r.status_code==201,r.text
    return r.json()


def upload(c, name='계획.xlsx', content=b'example excel bytes', parent=None):
    info=begin(c,name,content,parent)
    nid=info['id']
    chunk=info['part_size']
    for n,start in enumerate(range(0,max(1,len(content)),chunk),1):
        assert c.put(f'{BASE}/uploads/{nid}/parts/{n}',content=content[start:start+chunk]).status_code==200
    assert c.post(f'{BASE}/uploads/{nid}/complete').status_code==200
    return nid


def test_auth_csrf_and_roles(client):
    c=client
    anon=TestClient(c.app)
    assert anon.get(BASE+'/nodes').status_code==401
    assert anon.post(BASE+'/folders',json={'name':'bad'}).status_code==403
    assert c.post(BASE+'/folders',json={'name':'bad'},headers={'Origin':'https://evil.example'}).status_code==403
    assert c.post(BASE+'/members',json={'username':'member','password':PASSWORD,'display_name':'팀원'}).status_code==201
    assert c.post(BASE+'/logout').status_code==200
    assert c.get(BASE+'/nodes').status_code==401
    assert c.post(BASE+'/login',json={'username':'member','password':PASSWORD}).status_code==200
    assert c.post(BASE+'/members',json={'username':'other','password':PASSWORD,'display_name':'다른 팀원'}).status_code==403


def test_nested_folders_cycle_conflict_and_move(client):
    c=client
    a=folder(c,'사업 자료');b=folder(c,'하위 폴더',a)
    assert c.post(BASE+'/folders',json={'name':'사업 자료'}).status_code==409
    assert c.patch(BASE+'/nodes/'+a,json={'parent_id':b}).status_code==400
    assert c.patch(BASE+'/nodes/'+b,json={'parent_id':None,'name':'이동된 폴더'}).status_code==200
    assert len(c.get(BASE+'/nodes').json()['items'])==2
    for name in ('..','bad/name','\\bad','\x00bad'):
        assert c.post(BASE+'/folders',json={'name':name}).status_code==400


def test_round_trip_download_and_range(client):
    c=client;data=b'excel-file-contents'*40000;nid=upload(c,content=data)
    r=c.get(BASE+'/nodes/'+nid+'/download')
    assert r.content==data
    assert "filename*=utf-8''" in r.headers['content-disposition']
    r=c.get(BASE+'/nodes/'+nid+'/download',headers={'Range':'bytes=10-29'})
    assert r.status_code==206 and r.content==data[10:30]
    assert c.post(BASE+'/uploads/'+nid+'/complete').status_code==200


def test_resumable_upload_validates_all_parts(client):
    c=client;content=b'a'*(8*1024**2)+b'last';info=begin(c,'대용량.pptx',content);nid=info['id']
    assert c.post(BASE+'/uploads/'+nid+'/complete').status_code==409
    assert c.put(f'{BASE}/uploads/{nid}/parts/1',content=content[:info['part_size']]).status_code==200
    again=begin(c,'대용량.pptx',content)
    assert again['resumed'] and again['id']==nid
    status=c.get(BASE+'/uploads/'+nid).json()
    assert status['parts']==[{'number':1,'size':8*1024**2}]
    assert c.put(f'{BASE}/uploads/{nid}/parts/2',content=b'wrongsize').status_code==413
    assert c.post(f'{BASE}/uploads/{nid}/parts/3').status_code==400
    assert c.put(f'{BASE}/uploads/{nid}/parts/2',content=b'last').status_code==200
    assert c.post(BASE+'/uploads/'+nid+'/complete').status_code==200
    assert c.get(BASE+'/nodes/'+nid+'/download').content==content


def test_zero_byte_and_cancel(client):
    c=client;nid=upload(c,content=b'')
    assert c.get(BASE+'/nodes/'+nid+'/download').content==b''
    pending=begin(c,'cancel.xlsx',b'abc')['id']
    assert c.delete(BASE+'/uploads/'+pending).status_code==200
    assert not c.get(BASE+'/uploads').json()
    assert begin(c,'cancel.xlsx',b'abc')['id']!=pending


def test_trash_subtree_revokes_downloads_and_restores(client):
    c=client;a=folder(c,'A');b=folder(c,'B',a);nid=upload(c,parent=b)
    link=c.post(BASE+'/nodes/'+nid+'/shares',json={'days':1}).json()['url'];token=link.rsplit('/',1)[-1]
    assert c.delete(BASE+'/nodes/'+a).status_code==200
    assert c.get(BASE+'/nodes/'+nid+'/download').status_code==404
    assert c.get(BASE+'/shared/'+token).status_code==404
    assert c.post(BASE+'/nodes/'+nid+'/restore').status_code==409
    assert c.post(BASE+'/nodes/'+a+'/restore').status_code==200
    assert c.get(BASE+'/shared/'+token).status_code==200
    assert len(c.get(BASE+'/nodes',params={'parent_id':b}).json()['items'])==1


def test_restore_is_atomic_on_name_conflict(client):
    c=client;a=folder(c,'same');folder(c,'child',a)
    c.delete(BASE+'/nodes/'+a);folder(c,'same')
    assert c.post(BASE+'/nodes/'+a+'/restore').status_code==409
    assert len(c.get(BASE+'/nodes',params={'view':'trash'}).json()['items'])==2


def test_shares_expire_revoke_and_never_expose_storage_keys(client):
    c=client;nid=upload(c);r=c.post(BASE+'/nodes/'+nid+'/shares',json={'days':1}).json();token=r['url'].split('/')[-1]
    anonymous=TestClient(c.app)
    info=anonymous.get(BASE+'/shared/'+token)
    assert info.status_code==200 and set(info.json())=={'name','size','updated'}
    assert anonymous.get(BASE+'/shared/'+token+'/download').status_code==200
    with c.app.state.db(write=True) as db:db.execute('UPDATE shares SET expires=? WHERE id=?',(int(time.time())-1,r['id']))
    assert anonymous.get(BASE+'/shared/'+token).status_code==404
    r=c.post(BASE+'/nodes/'+nid+'/shares',json={'days':7}).json()
    c.delete(BASE+'/shares/'+r['id'])
    assert anonymous.get(BASE+'/shared/'+r['url'].split('/')[-1]).status_code==404


def test_user_cannot_resume_other_users_upload(client):
    c=client;nid=begin(c,'private-progress.xlsx',b'abc')['id']
    c.post(BASE+'/members',json={'username':'member','password':PASSWORD,'display_name':'팀원'})
    c.post(BASE+'/logout');c.post(BASE+'/login',json={'username':'member','password':PASSWORD})
    assert c.get(BASE+'/uploads/'+nid).status_code==404
    assert c.delete(BASE+'/uploads/'+nid).status_code==404


def test_search_star_and_type_filter(client):
    c=client;nid=upload(c);upload(c,'deck.pptx')
    assert len(c.get(BASE+'/nodes',params={'q':'계획'}).json()['items'])==1
    assert len(c.get(BASE+'/nodes',params={'type':'ppt'}).json()['items'])==1
    assert c.post(BASE+'/nodes/'+nid+'/star').status_code==200
    assert c.get(BASE+'/nodes',params={'view':'starred'}).json()['items'][0]['id']==nid


def test_s3_multipart_roundtrip_and_presigned_urls(tmp_path,monkeypatch):
    monkeypatch.setenv('AWS_ACCESS_KEY_ID','testing');monkeypatch.setenv('AWS_SECRET_ACCESS_KEY','testing')
    with mock_aws():
        s3=boto3.client('s3',region_name='us-east-1');s3.create_bucket(Bucket='pmk-test')
        app=create_app(Settings(data_dir=tmp_path,admin_password=PASSWORD,app_url='http://testserver/pmk_drive',backend='s3',bucket='pmk-test',region='us-east-1'))
        with TestClient(app,headers={'X-PMK-Request':'1'}) as c:
            c.post(BASE+'/login',json={'username':'admin','password':PASSWORD})
            data=b'a'*(8*1024**2)+b'last';info=begin(c,'cloud.pptx',data);nid=info['id']
            signed=c.post(f'{BASE}/uploads/{nid}/parts/1').json()
            assert signed['direct'] and 'X-Amz-Signature=' in signed['url']
            with app.state.db() as db:upload_id=db.execute('SELECT upload_id FROM uploads WHERE node_id=?',(nid,)).fetchone()[0]
            for n,start in enumerate(range(0,len(data),info['part_size']),1):s3.upload_part(Bucket='pmk-test',Key='pmk-drive/'+nid,UploadId=upload_id,PartNumber=n,Body=data[start:start+info['part_size']])
            assert len(c.get(BASE+'/uploads/'+nid).json()['parts'])==2
            assert c.post(BASE+'/uploads/'+nid+'/complete').status_code==200
            assert s3.get_object(Bucket='pmk-test',Key='pmk-drive/'+nid)['Body'].read()==data
            assert c.get(BASE+'/nodes/'+nid+'/download',follow_redirects=False).status_code==302


def test_imported_hvc_password(tmp_path):
    salt='ab'*16;hashed=hashlib.pbkdf2_hmac('sha256',PASSWORD.encode(),bytes.fromhex(salt),600000).hex()
    app=create_app(Settings(data_dir=tmp_path,admin_password_hash=f'pbkdf2:600000:{salt}:{hashed}'))
    with TestClient(app,headers={'X-PMK-Request':'1'}) as c:
        assert c.post(BASE+'/login',json={'username':'admin','password':PASSWORD}).status_code==200


def test_gcs_compose_preserves_order_across_more_than_32_parts():
    from app.storage import GCSStorage
    class Blob:
        def __init__(self,bucket,name,generation=None):
            self.bucket=bucket;self.name=name;self.generation=generation
        def compose(self,sources,**kwargs):
            assert 1<=len(sources)<=32
            assert len(kwargs['if_source_generation_match'])==len(sources)
            self.bucket.objects[self.name]=b''.join(self.bucket.objects[x.name] for x in sources)
            self.generation=999
        def delete(self,**kwargs):self.bucket.objects.pop(self.name)
    class Bucket:
        def __init__(self):self.objects={}
        def blob(self,name,generation=None):return Blob(self,name,generation)
    class Client:
        def list_blobs(self,bucket,prefix):
            return [Blob(bucket,name,1) for name in list(bucket.objects) if name.startswith(prefix)]
    store=GCSStorage.__new__(GCSStorage);store.bucket=Bucket();store.client=Client()
    parts=[];expected=b''
    for n in range(1,66):
        content=bytes([n]);expected+=content;store.bucket.objects[store.part_key('test',n)]=content
        parts.append({'PartNumber':n,'Size':1,'ETag':str(n)})
    store.finish('test','test',parts)
    assert store.bucket.objects=={'pmk-drive/test':expected}
