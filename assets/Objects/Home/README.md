# Home wagon

`home_wagon.png` is the generated medieval travelling-home replacement for the
modern camper. The shared `house_trailer` texture supplies both map and Home icon.
Its 108×75 transparent frame preserves building scale; buildings use their own
centred placement rather than the cell-sprite `ART_BOUNDS` table.

Generated with the built-in imagegen tool from the previous trailer sprite.
The selected design uses weathered timber, an arched moss-green roof with copper
seams, iron fittings, amber leaded windows, wooden spoked wheels and a stovepipe.
The master is preserved in the local `story-repaint-review` artifacts.

Export: crop to alpha bounds, fit within 106×73 using Lanczos, reduce to 48 RGB
colours without dithering, threshold alpha at 128, then centre horizontally on
a transparent 108×75 frame with the fitted image ending at y=74. The old camper
sources and approved palette export remain preserved in their original folders.
