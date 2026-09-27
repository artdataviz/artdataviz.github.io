import numpy as np
import pandas as pd
import pytest
from matplotlib.colors import to_rgb, to_rgba
from PIL import Image

from binary_bars import (
    LINE_STYLES,
    dash_pattern,
    Chart,
    Motion,
    Style,
    build_bar,
    frame_state,
    load_values,
    render,
    rows_for,
    still,
)

MOTION = Motion()
F = MOTION.frames


def make_bar(value=4915, seed=1):
    return build_bar(value, row_value=77, motion=MOTION, rng=np.random.default_rng(seed))


def all_states(bar):
    return [frame_state(bar, f, MOTION) for f in range(F)]


def test_rows_floor_the_value():
    assert rows_for(4915, 77) == 63
    assert rows_for(2123, 77) == 27
    assert rows_for(76, 77) == 0


def test_height_is_the_same_in_every_frame():
    bar = make_bar()
    for state in all_states(bar):
        assert state.chars.shape == (63, 5)


def test_top_row_is_never_blank():
    bar = make_bar()
    for state in all_states(bar):
        assert (state.chars[-1] != ' ').all()


def test_top_row_bits_flip_exactly_twice_per_loop():
    bar = make_bar()
    top = np.array([s.chars[-1] for s in all_states(bar)])       # (F, cols)
    changes = (top != np.roll(top, 1, axis=0)).sum(axis=0)       # wraps frame 0 against frame F-1
    assert (changes == 2).all()


def test_top_row_never_dissolves():
    bar = make_bar()
    for state in all_states(bar):
        assert (state.fade[-1] == 1).all()


def test_body_streams_down_one_row_per_speed_step():
    bar = make_bar()
    for c, speed in enumerate(bar.speeds):
        for f in range(F):                                       # f + speed crosses the loop seam too
            now, later = frame_state(bar, f, MOTION), frame_state(bar, f + speed, MOTION)
            # body rows 1..n-3 move to rows 0..n-4 one step later; row 0 has its own blank rule
            np.testing.assert_array_equal(later.chars[1:-2, c], now.chars[2:-1, c])


def test_loop_is_seamless():
    bar = make_bar()
    first, wrapped = frame_state(bar, 0, MOTION), frame_state(bar, F, MOTION)
    np.testing.assert_array_equal(first.chars, wrapped.chars)
    np.testing.assert_allclose(first.alpha, wrapped.alpha)


def test_speeds_divide_the_loop():
    bar = make_bar()
    assert set(bar.speeds) <= set(MOTION.speeds)
    assert all(F % s == 0 for s in bar.speeds)


def test_bottom_row_is_denser_than_body():
    states = [s for seed in range(20) for s in all_states(make_bar(seed=seed))]
    bottom = np.mean([(s.chars[0] == ' ').mean() for s in states])
    body = np.mean([(s.chars[1:-1] == ' ').mean() for s in states])
    assert bottom == pytest.approx(MOTION.p_blank_bottom, abs=0.03)
    assert body == pytest.approx(MOTION.p_blank_body, abs=0.03)


def test_sparkle_and_dissolve_hit_their_rates():
    states = [s for seed in range(20) for s in all_states(make_bar(seed=seed))]
    sparkling = np.mean([(s.sparkle[:-1] > 0).mean() for s in states])
    dissolving = np.mean([(s.fade[:-1] < 1).mean() for s in states])
    assert sparkling == pytest.approx(MOTION.sparkle_rate, abs=0.005)
    assert dissolving == pytest.approx(MOTION.dissolve_rate, abs=0.01)


def test_alpha_stays_in_range():
    lo, hi = MOTION.alpha_range
    for state in all_states(make_bar()):
        assert (state.alpha >= 0).all() and (state.alpha <= 1).all()
        steady = (state.sparkle == 0) & (state.fade == 1)
        assert (state.alpha[steady] >= lo).all() and (state.alpha[steady] <= hi).all()


def test_short_value_gives_empty_bar():
    state = frame_state(make_bar(value=50), 0, MOTION)
    assert state.chars.shape == (0, 5)


def test_load_values_keeps_file_order(tmp_path):
    csv = tmp_path / 'v.csv'
    csv.write_text('category,group,value\nB,x,1\nB,y,2\nA,x,3\nA,y,4\n')
    values = load_values(csv)
    assert list(values.index) == ['B', 'A']
    assert list(values.columns) == ['x', 'y']
    assert values.loc['A', 'y'] == 4


def test_render_writes_still_and_media(tmp_path):
    csv = tmp_path / 'v.csv'
    csv.write_text('category,group,value\nA,x,300\nA,y,600\nB,x,450\nB,y,150\n')
    motion = Motion(frames=12, fps=6)
    out = render(load_values(csv), tmp_path / 'chart', Style(), motion,
                 row_value=77, seed=3, video_width=480, gif_width=320, loops=2)
    assert Image.open(out['png']).size == (2400, 1440)
    assert out['mp4'].stat().st_size > 0
    gif = Image.open(out['gif'])
    assert gif.size == (320, 192)
    assert gif.n_frames == 12
    for i in range(gif.n_frames):                       # 128-colour palette keeps a full loop under 5 MB
        gif.seek(i)
        assert len(gif.convert('RGB').getcolors(maxcolors=100_000)) <= 128


def test_stream_is_30_percent_slower_than_first_cut():
    # first cut: 16 fps, fastest column one row per frame -> 16 rows/s
    m = Motion()
    assert m.fps / min(m.speeds) == pytest.approx(16 * 0.7)
    assert m.frames / m.fps == pytest.approx(96 / 11.2)


def test_frame_rate_doubled_for_smoother_fades():
    assert Motion().fps == pytest.approx(22.4)


def test_sparkle_is_141x_three_times_over_the_first_cut():
    assert Motion().sparkle_rate == pytest.approx(0.02 * 1.41 ** 3, abs=1e-4)


def test_holes_are_20_percent_fewer_than_2024():
    m = Motion()
    assert m.p_blank_body == pytest.approx(3 / 7 * 0.8)
    assert m.p_blank_bottom == pytest.approx(1 / 5 * 0.8)


def test_share_of_full_bright_bits():
    states = [s for seed in range(10) for s in all_states(make_bar(seed=seed))]
    steady = np.concatenate([s.alpha[(s.sparkle == 0) & (s.fade == 1)] for s in states])
    assert (steady == 1).mean() == pytest.approx(MOTION.p_full, abs=0.03)


LINES = ((2500, '#719D00', 'good', 'down'), (4000, '#DE5D4D', 'poor', 'up'))


def make_chart(hlines=LINES, **style):
    values = pd.DataFrame({'x': [3049.0, 3387.0], 'y': [2653.0, 2123.0]}, index=['A', 'B'])
    return Chart(values, Style(hlines=hlines, **style), MOTION, 77, np.random.default_rng(0))


def test_glyphs_stand_in_for_one_and_zero():
    chart = make_chart(glyphs='zZ')
    chart.update(5)
    for bar, _, rows in chart.bars:
        bits = frame_state(bar, 5, MOTION).chars
        shown = np.array([[t.get_text() for t in row] for row in rows])
        assert (shown == np.select([bits == '1', bits == '0'], ['z', 'Z'], ' ')).all()


def test_default_glyphs_are_bits():
    assert Style().glyphs == '10'


@pytest.mark.parametrize('glyphs', ['z', 'zZz', 'z ', ''])
def test_glyphs_must_be_two_visible_characters(glyphs):
    with pytest.raises(ValueError):
        Style(glyphs=glyphs)


def test_glyphs_have_no_boxes_so_rows_cannot_crop_each_other():
    chart = make_chart()
    texts = [t for _, _, rows in chart.bars for row in rows for t in row]
    assert texts and all(t.get_bbox_patch() is None for t in texts)


def test_each_bar_has_a_mask_below_its_glyphs_and_above_the_lines():
    chart = make_chart()
    for bar, mask, rows in zip(chart.bars, chart.masks, [b[2] for b in chart.bars]):
        assert mask.get_zorder() < rows[0][0].get_zorder()
        assert mask.get_zorder() > max(l.get_zorder() for l in chart.ax.lines)
        assert mask.get_height() >= bar[0].n_rows * 77


def test_threshold_values_get_y_ticks():
    ticks = make_chart().ax.get_yticks()
    assert 2500 in ticks and 4000 in ticks


def test_threshold_lines_carry_labels():
    texts = [t.get_text() for t in make_chart().ax.texts]
    assert 'good' in texts and 'poor' in texts


@pytest.mark.parametrize('line_style', ['dashes', 'dots'])
def test_threshold_line_shows_up_in_the_png(tmp_path, line_style):
    values = pd.DataFrame({'x': [300.0, 200.0]}, index=['A', 'B'])
    style = Style(hlines=((150, '#00FF00'),), line_style=line_style, line_alpha=1.0, line_width=1.5)
    png = still(values, tmp_path / 'c', style, MOTION, row_value=77, seed=0, width=800)['png']
    pixels = np.asarray(Image.open(png).convert('RGB')).reshape(-1, 3).astype(int)
    green = (pixels[:, 1] > 150) & (pixels[:, 0] < 100) & (pixels[:, 2] < 100)
    assert green.sum() > 20


def _drawn(chart):
    chart.fig.canvas.draw()
    return {tx.get_text(): tx for tx in chart.ax.texts if tx.get_text() in ('good', 'poor', '↓', '↑')}


def test_labels_sit_past_the_line_end_inside_the_figure():
    chart = make_chart()
    labels = _drawn(chart)
    line_end = chart.ax.transAxes.transform((0.97, 0))[0]
    for tx in labels.values():
        box = tx.get_window_extent()
        assert box.x0 > line_end and box.x1 <= chart.fig.bbox.x1


def test_words_are_centred_on_their_lines():
    chart = make_chart()
    labels = _drawn(chart)
    for word, y in (('good', 2500), ('poor', 4000)):
        box = labels[word].get_window_extent()
        line_y = chart.ax.transData.transform((0, y))[1]
        assert box.y0 < line_y < box.y1
        assert abs((box.y0 + box.y1) / 2 - line_y) < 2              # px


def test_arrow_points_down_under_good_and_up_over_poor():
    chart = make_chart()
    labels = _drawn(chart)
    good, down = labels['good'].get_window_extent(), labels['↓'].get_window_extent()
    poor, up = labels['poor'].get_window_extent(), labels['↑'].get_window_extent()
    assert down.y1 <= good.y0 + 1 and up.y0 >= poor.y1 - 1
    for word, arrow in ((good, down), (poor, up)):                  # one centred column
        assert abs((word.x0 + word.x1) / 2 - (arrow.x0 + arrow.x1) / 2) < 1


def test_labels_are_white_at_70_percent():
    for tx in _drawn(make_chart()).values():
        assert to_rgba(tx.get_color()) == pytest.approx((1, 1, 1, 0.7))


def test_threshold_lines_are_opaque():
    chart = make_chart()
    colours = [to_rgba(line.get_color()) for line in chart.ax.lines]
    assert colours == [pytest.approx(to_rgba('#719D00')), pytest.approx(to_rgba('#DE5D4D'))]


def oklch_lightness(hex_colour):
    """OKLCH L of an sRGB colour, 0..1 (Ottosson's OKLab)."""
    r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in to_rgb(hex_colour))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s


def test_bars_match_in_lightness_and_lines_sit_below_them():
    bars = [oklch_lightness(c) for c in Style().colors]
    lines = [oklch_lightness(c) for _, c, *_ in LINES]
    assert bars == pytest.approx([0.71, 0.71], abs=0.005)
    assert lines == pytest.approx([0.64, 0.64], abs=0.005)


def test_threshold_lines_are_1px():
    assert Style().line_width == 0.75                         # pt: 1 px in a browser


@pytest.mark.parametrize('width', [0.75, 1.5])
def test_dot_gap_stays_4_5pt_at_any_width(width):
    (on, off), cap = dash_pattern(Style(line_width=width))
    assert cap == 'round'
    assert off * width - width == pytest.approx(4.5)          # the gap minus the two half-width caps


def test_dots_are_the_default_line_style():
    assert Style().line_style == 'dots'


def test_seventy_percent_of_bits_are_full_bright():
    assert Motion().p_full == pytest.approx(0.7)


def _key_parts(chart):
    """(kind, value) for each piece of the subtitle key, left to right."""
    from matplotlib.offsetbox import DrawingArea, TextArea
    parts = []

    def walk(box):
        for child in box.get_children():
            if isinstance(child, DrawingArea):
                parts.append(('dot', to_rgba(child.get_children()[0].get_facecolor())))
            elif isinstance(child, TextArea):
                parts.append(('text', child.get_text().strip()))
            else:
                walk(child)
    walk(chart.key.get_child())
    return parts


def test_subtitle_is_the_legend_so_there_is_no_legend_box():
    chart = make_chart()
    assert chart.ax.get_legend() is None
    assert _key_parts(chart) == [
        ('dot', pytest.approx(to_rgba(Style().colors[0]))), ('text', 'x'), ('text', 'vs'),
        ('dot', pytest.approx(to_rgba(Style().colors[1]))), ('text', 'y'),
    ]


def test_subtitle_key_is_centred_above_the_plot():
    chart = make_chart()
    chart.fig.canvas.draw()
    key, axes = chart.key.get_window_extent(), chart.ax.get_window_extent()
    assert abs((key.x0 + key.x1) / 2 - (axes.x0 + axes.x1) / 2) < 2
    assert key.y0 >= axes.y1


def test_bar_colours_match_in_lightness():
    # CloudFront lifted from #895FEE (OKLCH L 0.60) to #A68BFE (0.71), level with Cloudflare's orange
    assert Style().colors == ('#E5873B', '#A68BFE')
