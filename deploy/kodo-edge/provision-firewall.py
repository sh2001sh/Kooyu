"""Run on codego-new-db as root. Preserve all existing firewall rules."""
from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

MARKER = 'kodo-edge-https'
RULE = '        tcp dport { 80, 443 } accept comment "' + MARKER + '"\n'
config = Path('/etc/nftables.conf')
original = config.read_text()
if 'table inet codego_filter' not in original:
    raise SystemExit('Unexpected firewall layout; no change applied.')
anchor = '        tcp dport 22 accept\n'
if MARKER not in original and original.count(anchor) != 1:
    raise SystemExit('Expected exactly one SSH rule; no change applied.')

candidate = original if MARKER in original else original.replace(anchor, anchor + RULE, 1)
with tempfile.NamedTemporaryFile(mode='w', dir='/etc', prefix='.kodo-nft-', delete=False) as f:
    f.write(candidate)
    temp_path = Path(f.name)
try:
    subprocess.run(['nft', '-c', '-f', str(temp_path)], check=True)
    live = subprocess.run(['nft', 'list', 'chain', 'inet', 'codego_filter', 'input'],
                          check=True, capture_output=True, text=True).stdout
    if candidate != original:
        backups = Path('/root/kodo-deployment-backups')
        backups.mkdir(mode=0o700, exist_ok=True)
        os.chmod(backups, 0o700)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        shutil.copy2(config, backups / ('nftables.conf.' + stamp))
        (backups / ('input-chain.' + stamp + '.txt')).write_text(live)
        shutil.copymode(config, temp_path)
        os.replace(temp_path, config)
    if MARKER not in live:
        # Add only this rule. Do not load nftables.conf: it contains flush ruleset.
        subprocess.run(['nft', 'add', 'rule', 'inet', 'codego_filter', 'input',
                        'tcp', 'dport', '{', '80', ',', '443', '}', 'accept',
                        'comment', '"' + MARKER + '"'], check=True)
    print('TCP 80/443 enabled; existing SSH, database, VPN and Docker rules preserved.')
finally:
    temp_path.unlink(missing_ok=True)
