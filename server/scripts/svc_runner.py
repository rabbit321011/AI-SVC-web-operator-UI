import sys
import types
import os
import warnings
warnings.filterwarnings('ignore')

YINGMUSIC = 'E:/AIscene/AISVCs/YingMusic-SVC'
TEMP = 'E:/AIscene/AISVCs/temp/temp_0502'
sys.path.insert(0, YINGMUSIC)
sys.path.insert(0, TEMP)

# dummy sox_effects (needed by Remix/auger.py top-level import)
_sox_dummy = types.ModuleType('torchaudio.sox_effects')
_sox_dummy.apply_effects_tensor = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('sox_effects n/a'))
sys.modules['torchaudio.sox_effects'] = _sox_dummy

import torchaudio
torchaudio.sox_effects = _sox_dummy

# The ORIGINAL YingMusic-SVC/my_inference.py uses soundfile.sf.write() on
# line 345, not torchaudio.save(). No torchcodec needed.

import soundfile as sf
assert sf, 'soundfile required'

my_inference = os.path.join(YINGMUSIC, 'my_inference.py')
with open(my_inference, 'r', encoding='utf-8') as f:
    code = compile(f.read(), my_inference, 'exec')

sys.argv = [my_inference] + sys.argv[1:]
exec(code, {'__name__': '__main__', '__file__': my_inference})
