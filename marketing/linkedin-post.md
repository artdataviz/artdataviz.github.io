# LinkedIn post — 8,631 stars

Image: `linkedin-8631-stars-4x5.jpg` (1200 × 1500)
Link: https://artdataviz.github.io/8631-stars/ — **paste as the first comment, not in the post**

---

## Post body

119,626 rows in a star catalogue. 8,631 pass one filter: can the naked eye see it?

That is the dataset. Here is how it maps to an image.

Three variables, three visual channels:

Position (RA, declination, distance) → where the star sits in 3D space, at its real distance
Apparent magnitude → brightness, rescaled from log to linear
Colour index (B−V) → temperature → RGB, from 2,213 K to 16,991 K

The fourth channel, size, encodes nothing. That was on purpose.

Real stars are points, so I had to invent a radius. Give every star the same real size and the closest one looks 740× bigger than the farthest. That encodes distance, not brightness. So the radius grows with distance instead. Now every star covers the same pixels, distance cancels out, and only magnitude is left.

Two more decisions worth naming.

Exposure is measured, not eyeballed. A magnitude 6.5 star lands at 57/255. I set that constant by measuring the render, not by moving a slider until it looked good.

Bloom handles the dynamic range. Sirius is 1,500× brighter than the faintest star here. Pixels stop at 255. Bloom spreads the extra light instead of clipping it. Your eye does the same thing.

Everything else comes straight from the catalogue.

HYG v4.2, rendered in Blender/Cycles at 16,084 × 8,042, served as a 360° panorama you can drag.

When would you reach for Blender instead of matplotlib?

Link in the first comment.

#dataviz #datavisualization #astronomy

---

## First comment (post immediately after publishing)

Drag the sky here, plus the full account of every choice behind it:
https://artdataviz.github.io/8631-stars/

---

## Why it is shaped this way

- **Hook.** The dataset and its single filter, in 82 characters. Lands before the "see more" cut.
- **Spine.** Encoding, not rendering. Variables map to channels, and the fourth channel is empty on purpose. That is an argument a dataviz reader can agree or disagree with.
- **Language.** Short sentences, common words, no metaphors. The numbers carry the weight.
- **Length.** ~1,450 characters, inside the 1,300–1,900 band.
- **No link in the body.** Avoids the 40–60% reach penalty. The link goes in comment one.
- **Plain text.** LinkedIn renders no markdown, and Unicode bold breaks screen readers.
- **Closing question.** A tool question gets argued, and disagreement produces the long comments that weigh 2.5×. It also plants "matplotlib", a word the body never uses.
- **3 niche hashtags.**

Stay free to answer comments for 90 minutes after publishing. That window sets the reach.

## Answers to expect in the comments

The real case for Blender over matplotlib, if you get asked:

- Emission adds. Matplotlib composites semi-transparent marks with alpha `over`, so two faint overlapping stars do not sum.
- Matplotlib has no equirectangular camera, which is the whole 360° delivery format.
- `mplot3d` sorts artists by depth and has no z-buffer, so real 3D occlusion is not available.
- Numpy still did the filtering, the scales and the position tests. Blender only rendered the final frame.
