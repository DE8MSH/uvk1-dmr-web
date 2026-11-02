#!/usr/bin/env python3
"""Repack JS changes while preserving the embedded decoder, self-test and licenses."""
from pathlib import Path
import re,json
root=Path(__file__).resolve().parent.parent
p=root/'index.html';s=p.read_text()
worker=json.loads(re.search(r'<script type="application/json" id="worker-source">(.*?)</script>',s,re.S).group(1))
marker='// SPDX-License-Identifier: GPL-3.0-or-later\nlet mod,'
worker=worker[:worker.index(marker)]+(root/'src/worker.js').read_text()
fixture=re.search(r"const SELFTEST_BASE64='([^']+)'",s).group(1)
app=(root/'src/app.js').read_text().replace('__AUDIO_WORKLET_SOURCE__',json.dumps((root/'src/audio-worklet.js').read_text())).replace('__SELFTEST_BASE64__',fixture)
s=re.sub(r'(<script type="application/json" id="worker-source">).*?(</script>)',lambda m:m[1]+json.dumps(worker).replace('<','\\u003c')+m[2],s,count=1,flags=re.S)
s=re.sub(r'(</script><script>).*?(</script>)',lambda m:m[1]+'\n'+app+'\n'+m[2],s,count=1,flags=re.S)
p.write_text(s)
print('Repacked index.html; embedded WASM unchanged')
