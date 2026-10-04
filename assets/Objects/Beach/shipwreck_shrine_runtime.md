# Shipwreck runtime image

`shipwreck_shrine_runtime.png` is a 192×128 RGBA derivative of the preserved
1536×1024 `shipwreck_shrine.png`. The map draws the wreck at 96×64 logical
pixels; this supplies native pixels at the game's 2× backing resolution cap.
Its scale in `SpriteLayout.SHIPWRECK_SHRINE_ART` preserves the three-cell width.

Regenerate with Pillow:

```python
from PIL import Image
Image.open('assets/Objects/Beach/shipwreck_shrine.png').convert('RGBA').resize(
    (192, 128), Image.Resampling.LANCZOS
).save('assets/Objects/Beach/shipwreck_shrine_runtime.png', optimize=True)
```

The derivative keeps transparency and uses the original image's licensing.
