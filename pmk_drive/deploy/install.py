"""Run as root from an extracted, tested release: python3 deploy/install.py.
Keeps existing nginx routes, imports only the existing HVC password verifier.
"""
import os
import pwd
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

source = Path(__file__).resolve().parents[1]
root = Path('/opt/pmk_drive')
release = root / 'releases' / source.name
assert source == release, 'Extract this package into /opt/pmk_drive/releases/<release-id> first'
assert os.geteuid() == 0
run = lambda *args: subprocess.run(args, check=True)
try:
    account = pwd.getpwnam('pmk-drive')
except KeyError:
    run('useradd', '--system', '--home', '/var/lib/pmk-drive', '--shell', '/usr/sbin/nologin', 'pmk-drive')
    account = pwd.getpwnam('pmk-drive')
state = Path('/var/lib/pmk-drive'); state.mkdir(exist_ok=True, mode=0o700)
os.chown(state, account.pw_uid, account.pw_gid)
config = Path('/etc/pmk-drive'); config.mkdir(exist_ok=True, mode=0o750)
os.chown(config, 0, account.pw_gid)
assert (config / 'storage-key.json').exists(), 'Provision the dedicated storage credential first'
venv = root / 'venv'
if not venv.exists(): run('python3', '-m', 'venv', str(venv))
run(str(venv / 'bin/pip'), 'install', '-r', str(source / 'requirements.txt'))
env = config / 'app.env'
if not env.exists():
    verifier = {}
    for line in Path('/etc/pmk_hvc.env').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            verifier[key] = value.strip().strip('"').strip("'")
    encoded = 'pbkdf2:600000:' + verifier['PASSWORD_SALT'] + ':' + verifier['PASSWORD_HASH']
    contents = '\n'.join([
        'BASE_PATH=/pmk_drive', 'APP_URL=https://34.47.71.229/pmk_drive',
        'DATA_DIR=/var/lib/pmk-drive', 'STORAGE_BACKEND=gcs',
        'GCS_BUCKET=gyutae-test-project-pmk-drive',
        'GOOGLE_APPLICATION_CREDENTIALS=/etc/pmk-drive/storage-key.json',
        'PMK_ADMIN_USERNAME=admin', 'PMK_ADMIN_PASSWORD_HASH='+encoded,
        'MAX_FILE_SIZE=107374182400', ''])
    fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(contents)
current = root / 'current'
previous = current.resolve() if current.exists() else None
next_link = root / 'current.next'
next_link.unlink(missing_ok=True); next_link.symlink_to(release); next_link.replace(current)
service = Path('/etc/systemd/system/pmk-drive.service')
shutil.copyfile(source / 'deploy/pmk-drive.service', service)
run('systemctl', 'daemon-reload')
site = Path('/etc/nginx/sites-available/skt-mainpage-dashboard')
before = site.read_text()
backup = root / ('nginx-before-' + str(int(time.time())) + '.conf')
backup.write_text(before)
try:
    run('systemctl', 'restart', 'pmk-drive.service')
    for attempt in range(50):
        try:
            with urllib.request.urlopen('http://127.0.0.1:4178/pmk_drive/health', timeout=2) as r:
                assert r.status == 200
            break
        except Exception:
            if attempt == 49: raise
            time.sleep(.3)
    marker = '    # BEGIN PMK DRIVE'
    if marker not in before:
        assert 'location = /pmk_drive' not in before, 'Existing unmanaged route; inspect before changing'
        anchor = '    location = /pmk_hvc {'
        assert before.count(anchor) == 1, 'Expected existing HTTPS PMK location'
        site.write_text(before.replace(anchor, (source / 'deploy/nginx-location.conf').read_text() + '\n' + anchor))
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    run('systemctl', 'enable', 'pmk-drive.service')
    print('PMK Drive installed; existing routes retained; metadata in /var/lib/pmk-drive; objects in private GCS bucket.')
except Exception:
    site.write_text(before)
    run('nginx', '-t'); run('systemctl', 'reload', 'nginx')
    if previous:
        next_link.unlink(missing_ok=True); next_link.symlink_to(previous); next_link.replace(current)
        run('systemctl', 'restart', 'pmk-drive.service')
    else:
        run('systemctl', 'stop', 'pmk-drive.service')
    raise
