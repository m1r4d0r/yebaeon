"""Build a local handoff bundle from committed source and explicitly provided originals."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'PP6-Playlist-Sync-Full-Dev-Bundle/'

def git(*args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + ROOT.as_posix(), *args], cwd=ROOT)

def archive_bytes(path):
    if not path.is_file() or path.is_symlink():
        raise ValueError('Expected a regular ZIP: ' + str(path))
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            parts = PurePosixPath(member.filename).parts
            if member.filename.startswith('/') or '..' in parts or '\\' in member.filename:
                raise ValueError('Unsafe archive entry')
        if archive.testzip():
            raise ValueError('Corrupt ZIP: ' + str(path))
    return path.read_bytes()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-original', type=Path, required=True)
    parser.add_argument('--core-original', type=Path, required=True)
    parser.add_argument('--assets-original', type=Path, required=True)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--app-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if git('status', '--porcelain').strip():
        raise ValueError('Commit source changes before making the handoff bundle.')
    commit = git('rev-parse', 'HEAD').decode().strip()
    app_commit = git('rev-parse', '--verify', args.app_commit + '^{commit}').decode().strip()
    # The compiled app must match all current native implementation files.
    if git('diff', '--name-only', app_commit, commit, '--', 'mac-app', 'mac-sync').decode().strip():
        changed = git('diff', '--name-only', app_commit, commit, '--', 'mac-app', 'mac-sync').decode().splitlines()
        if any(not name.endswith(('.md', '.py')) for name in changed):
            raise ValueError('Native code changed since the supplied app build.')
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a new bundle name.')
    output.parent.mkdir(parents=True, exist_ok=True)
    files = {}
    for record in git('ls-files', '-s', '-z').split(b'\0'):
        if not record:
            continue
        meta, name = record.split(b'\t', 1)
        mode, blob, stage = meta.decode().split()
        name = name.decode('utf-8')
        if stage != '0' or mode not in ('100644', '100755'):
            raise ValueError('Only committed regular files are supported: ' + name)
        files['source/' + name] = (git('cat-file', 'blob', blob), 0o755 if mode == '100755' else 0o644)
    for path, name in [(args.native_original, 'PP6-Playlist-Sync-Native-v0.2.zip'),
                       (args.core_original, 'PP6-Local-Sync-Core-v0.2.zip'),
                       (args.assets_original, 'PP6-Original-Source-Assets.zip')]:
        files['originals/' + name] = (archive_bytes(path), 0o644)
    files['app/YebaeOn-Sync-macOS.zip'] = (archive_bytes(args.app), 0o644)
    files['HANDOFF.md'] = (git('show', 'HEAD:docs/SESSION-HANDOFF.md'), 0o644)
    files['CHURCH-TEST.md'] = (git('show', 'HEAD:docs/CHURCH-TEST.md'), 0o644)
    start = """예배온 Sync 통합 개발 묶음

1. Mac에서 app/YebaeOn-Sync-macOS.zip을 풀고 예배온 Sync.app을 엽니다.
2. 기존 PP6 Playlist Sync.app·설정·백업은 보관하고, 기존 앱은 종료합니다.
3. HANDOFF.md에서 최신 작업 현황을, CHURCH-TEST.md에서 교회 확인 순서를 읽습니다.
4. 서버 재생목록 탭에서 원본 등록과 플레이리스트 단위 동기화를 시험합니다.
5. 직접 빌드하려면 source/mac-app/build.command를 실행합니다.

source/: 현재 커밋된 예배온 소스 전체
originals/: 제공받은 Native / Core / 원본 자료 ZIP을 그대로 보관
HANDOFF.md: 구성과 남은 단계
source/mac-app/README.md: 탭별 사용법
MANIFEST.json: 파일별 SHA-256, 소스 및 앱 빌드 커밋

미디어는 연결 점검까지 지원하며 서버 업로드·복사·경로 변경은 후속 작업입니다.
최신 Intel Mac 검사는 완료했지만 High Sierra와 실제 PP6에서 확인해야 합니다.
이 묶음에는 교회 원본 자료가 들어 있습니다. 소스 저장소에는 넣지 않습니다.
"""
    files['START-HERE.txt'] = (start.encode('utf-8'), 0o644)
    manifest = {'schema': 1, 'sourceCommit': commit, 'appBuildCommit': app_commit,
                'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                          for name, (data, _) in sorted(files.items())]}
    files['MANIFEST.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'), 0o644)
    temporary = output.with_suffix('.zip.partial')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, (data, mode) in sorted(files.items()):
                entry = zipfile.ZipInfo(PREFIX + name)
                entry.create_system = 3
                entry.external_attr = (0o100000 | mode) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, data)
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip():
                raise ValueError('Bundle CRC check failed')
            for entry in manifest['files']:
                data = archive.read(PREFIX + entry['path'])
                if hashlib.sha256(data).hexdigest() != entry['sha256']:
                    raise ValueError('Bundle hash check failed')
        temporary.replace(output)
    finally:
        if temporary.exists():
            temporary.unlink()
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.sha256').write_text(digest + '  ' + output.name + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'files': len(files), 'bytes': output.stat().st_size,
                      'sha256': digest, 'sourceCommit': commit, 'appBuildCommit': app_commit}))

if __name__ == '__main__':
    main()
