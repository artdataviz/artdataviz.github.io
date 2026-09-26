"""Binary bars: a bar chart built from ones and zeros, as a still and as a loop.

Bar heights carry the data; the bits are texture. In the animation the bits
stream down inside fixed-height bars, some sparkle, some dissolve, and the
last frame runs into the first without a seam.

    python binary_bars.py lcp_medians.csv --out cdn --row-value 77 \\
        --title 'Chrome User Timing → Largest Contentful Paint' \\
        --xlabel 'Tested from' --ylabel 'Median of Largest Contentful Paint, ms' \\
        --hline '2500:#719D00:good:down' --hline '4000:#DE5D4D:poor:up'

Input: a CSV with columns category, group, value; one row per bar, in the
order you want them drawn. --glyphs swaps the ones and zeros for two symbols
that suit the data, e.g. --glyphs zZ for sleep. The subtitle is the legend: each group's name after
a dot in its colour. Output: <out>.png (still), <out>.mp4, <out>.gif;
with --still-only, <out>.png and <out>.svg.
Needs matplotlib, numpy, pandas and ffmpeg on PATH.
"""
import argparse
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import to_rgb, to_rgba  # noqa: E402
from matplotlib.offsetbox import AnchoredOffsetbox, DrawingArea, HPacker, TextArea  # noqa: E402
from matplotlib.patches import Circle, Rectangle  # noqa: E402
from matplotlib.transforms import blended_transform_factory  # noqa: E402


# ---------------------------------------------------------------- motion model

@dataclass(frozen=True)
class Motion:
    frames: int = 192              # one seamless loop: 8.6 s
    fps: float = 22.4              # stream at 11.2 rows/s (16 x 0.7); the extra frames smooth fades
    speeds: tuple = (2, 4, 6)      # frames per one-row step; each must divide `frames`
    cols: int = 5                  # glyphs per row
    p_blank_bottom: float = 1 / 5 * 0.8   # 2024 blank rates, 20% fewer holes;
    p_blank_body: float = 3 / 7 * 0.8     # the base row stays denser than the body
    alpha_range: tuple = (0.57, 1.0)
    p_full: float = 0.7            # share of glyphs held at 100% opacity
    sparkle_rate: float = 0.0561   # share of glyphs mid-flash at any frame (2% x 1.41^3)
    sparkle_half: float = 3        # flash half-width, frames: 5 frames, 0.22 s
    whiten: float = 0.6            # how far a flash pales toward white
    dissolve_rate: float = 0.05    # share of glyphs mid-fade at any frame
    dissolve_half: float = 16      # fade half-width, frames: 31 frames, 1.4 s
    dissolve_depth: float = 0.9    # a fade bottoms out at 10% of the glyph's opacity
    top_flips: int = 2             # bit flips per top-row glyph per loop; even, so the loop closes

    def __post_init__(self):
        if any(self.frames % s for s in self.speeds):
            raise ValueError(f'every speed must divide frames={self.frames}')
        if self.top_flips % 2:
            raise ValueError('top_flips must be even')


@dataclass(frozen=True)
class Bar:
    """One bar's random material. Body glyphs come from a looping tape per column."""
    n_rows: int
    speeds: np.ndarray      # (cols,) frames per one-row step
    tape_bit: np.ndarray    # (frames, cols); column c loops over its first frames // speeds[c] cells
    tape_u: np.ndarray      # (frames, cols) uniform draw: a cell is blank where it falls below the row's p_blank
    tape_alpha: np.ndarray  # (frames, cols) base opacity
    tape_spark: np.ndarray  # (slots, frames, cols) frames of the cell's flashes, -1 for none
    tape_fade: np.ndarray   # (slots, frames, cols) frames of the cell's fades, -1 for none
    top_bit: np.ndarray     # (cols,) the top row never moves and is never blank
    top_alpha: np.ndarray
    top_spark: np.ndarray   # (slots, cols)
    top_flip: np.ndarray    # (top_flips, cols) frames where the top bit flips


@dataclass(frozen=True)
class State:
    """What one bar shows in one frame. Row 0 is the bottom."""
    chars: np.ndarray    # (n_rows, cols) '1', '0' or ' '
    alpha: np.ndarray
    sparkle: np.ndarray  # flash strength, 0..1
    fade: np.ndarray     # opacity multiplier from a dissolve, 1 = none


def rows_for(value, row_value):
    return int(value // row_value)


def build_bar(value, row_value, motion, rng):
    frames, cols = motion.frames, motion.cols
    tape = (frames, cols)

    def events(rate, half, shape):
        """Event frames per cell, -1 for none, with enough slots per cell to reach `rate`."""
        active = 2 * int(np.ceil(half)) - 1           # frames with a non-zero pulse
        per_cell = rate * frames / active             # events per cell per loop
        slots = max(1, int(np.ceil(per_cell)))
        shape = (slots, *np.atleast_1d(shape))
        return np.where(rng.random(shape) < per_cell / slots, rng.integers(0, frames, shape), -1)

    def base_alpha(shape):
        return np.where(rng.random(shape) < motion.p_full, 1.0, rng.uniform(*motion.alpha_range, shape))

    return Bar(
        n_rows=rows_for(value, row_value),
        speeds=rng.choice(motion.speeds, size=cols),
        tape_bit=rng.random(tape) < 0.5,
        tape_u=rng.random(tape),
        tape_alpha=base_alpha(tape),
        tape_spark=events(motion.sparkle_rate, motion.sparkle_half, tape),
        tape_fade=events(motion.dissolve_rate, motion.dissolve_half, tape),
        top_bit=rng.random(cols) < 0.5,
        top_alpha=base_alpha(cols),
        top_spark=events(motion.sparkle_rate, motion.sparkle_half, cols),
        top_flip=np.stack([rng.choice(frames, motion.top_flips, replace=False)
                           for _ in range(cols)], axis=1),
    )


def _pulse(event_frame, f, frames, half):
    """Triangle pulse centred on the event frame, measured around the loop."""
    d = (f - event_frame + frames / 2) % frames - frames / 2
    return np.where(event_frame >= 0, np.clip(1 - np.abs(d) / half, 0, 1), 0.0)


def frame_state(bar, f, motion):
    frames, cols = motion.frames, motion.cols
    f %= frames
    col = np.arange(cols)

    # Body and base: row r shows tape cell r + f // speed, so content moves down one row per step.
    r = np.arange(max(bar.n_rows - 1, 0))[:, None]
    idx = (r + f // bar.speeds) % (frames // bar.speeds)
    p_blank = np.where(r == 0, motion.p_blank_bottom, motion.p_blank_body)
    blank = bar.tape_u[idx, col] < p_blank
    body_chars = np.where(blank, ' ', np.where(bar.tape_bit[idx, col], '1', '0'))
    body_spark = _pulse(bar.tape_spark[:, idx, col], f, frames, motion.sparkle_half).max(axis=0)
    body_fade = 1 - motion.dissolve_depth * _pulse(bar.tape_fade[:, idx, col], f, frames,
                                                   motion.dissolve_half).max(axis=0)
    body_base = bar.tape_alpha[idx, col]

    # Top: fixed in place so the value edge stays still; bits flip, never blank, never fade.
    if bar.n_rows:
        flipped = (bar.top_flip <= f).sum(axis=0) % 2 == 1
        top_chars = np.where(bar.top_bit ^ flipped, '1', '0')[None]
        top_spark = _pulse(bar.top_spark, f, frames, motion.sparkle_half).max(axis=0)[None]
        top_fade = np.ones((1, cols))
        top_base = bar.top_alpha[None]
    else:
        top_chars, top_spark, top_fade, top_base = (np.empty((0, cols)),) * 4

    chars = np.vstack([body_chars, top_chars]).astype('<U1')
    spark = np.vstack([body_spark, top_spark])
    fade = np.vstack([body_fade, top_fade])
    faded = np.vstack([body_base, top_base]) * fade
    return State(chars=chars, alpha=faded + (1 - faded) * spark, sparkle=spark, fade=fade)


# ---------------------------------------------------------------- data

def load_values(path):
    """Tidy CSV (category, group, value) -> categories x groups, in file order."""
    df = pd.read_csv(path)
    return (df.pivot(index='category', columns='group', values='value')
            .loc[df['category'].unique(), df['group'].unique()])


# ---------------------------------------------------------------- drawing

@dataclass(frozen=True)
class Style:
    title: str = ''
    xlabel: str = ''
    ylabel: str = ''
    colors: tuple = ('#E5873B', '#A68BFE')  # one per group, in file order; equal OKLCH lightness 0.71
    hlines: tuple = ()                      # ((value, color[, label[, 'up'|'down']]), ...)
    line_style: str = 'dots'                # 'dots' or 'dashes'
    line_width: float = 0.75                # pt: 1 px in a browser
    line_alpha: float = 1.0                 # line colours carry their own OKLCH lightness
    label_color: tuple = (1, 1, 1, 0.7)     # white at 70%
    label_dx: float = 15                    # pt from the line end to the label column's centre
    background: str = '#232425'
    ink: str = '#EEEEEE'
    ink_dim: str = '#AAAAAA'
    figsize: tuple = (10, 6)
    glyphs: str = '10'                      # symbols shown for a 1 bit and a 0 bit; a space is a gap
    glyph_size: float = 4.5                 # pt
    glyph_step: float = 0.034               # x distance between glyph columns
    bar_pitch: float = 0.234                # x distance between bars in one category
    category_step: float = 1.25

    def __post_init__(self):
        if len(self.glyphs) != 2 or any(g.isspace() for g in self.glyphs):
            raise ValueError(f'glyphs takes two visible characters, e.g. "10" or "zZ", not {self.glyphs!r}')

    def rc(self):
        return {
            'figure.facecolor': self.background, 'axes.facecolor': self.background,
            'text.color': self.ink, 'axes.labelcolor': self.ink, 'axes.labelpad': 17,
            'xtick.color': self.ink_dim, 'ytick.color': self.ink_dim,
            'axes.spines.left': False, 'axes.spines.bottom': False,
            'axes.spines.right': False, 'axes.spines.top': False,
            'legend.frameon': False, 'legend.borderpad': 1.4, 'legend.labelspacing': 0.7,
            'legend.handlelength': 0.7, 'legend.handleheight': 0.7,
            'font.family': 'sans-serif',
        }


def _subtitle_key(groups, style, size=10):
    """'● Cloudflare vs ● Amazon CloudFront': a dot in each group's colour, names in ink."""
    def entry(g, group):
        dot = DrawingArea(8, 8)
        dot.add_artist(Circle((4, 4), 3.5, facecolor=style.colors[g], edgecolor='none'))
        return HPacker(children=[dot, TextArea(group, textprops=dict(color=style.ink, fontsize=size))],
                       align='center', sep=4, pad=0)
    joiner = 'vs' if len(groups) == 2 else '·'
    parts = []
    for g, group in enumerate(groups):
        if g:
            parts.append(TextArea(joiner, textprops=dict(color=style.ink_dim, fontsize=size)))
        parts.append(entry(g, group))
    return HPacker(children=parts, align='center', sep=9, pad=0)


LINE_STYLES = {                             # (dash, gap) in points, cap style
    'dashes': ((6, 3.75), 'butt'),
    'dots': ((0, 4.5), 'round'),            # a dot is a zero-length dash with round caps
}


def dash_pattern(style):
    """LINE_STYLES in line widths, as matplotlib wants them, so gaps stay fixed in points
    whatever the width. Round caps add half a width at each end of every dash."""
    (dash, gap), cap = LINE_STYLES[style.line_style]
    width = style.line_width
    caps = width if cap == 'round' else 0
    return (max(dash / width, 0.01), (gap + caps) / width), cap    # Agg draws nothing for 0


class Chart:
    """The figure plus one text artist per glyph slot; update(f) redraws the bits."""

    def __init__(self, values, style, motion, row_value, rng):
        if values.shape[1] > len(style.colors):
            raise ValueError(f'{values.shape[1]} groups but {len(style.colors)} colours')
        self.motion = motion
        self.glyph_map = str.maketrans('10', style.glyphs)
        self.fig, ax = plt.subplots(figsize=style.figsize)
        self.ax = ax
        x = np.arange(values.shape[0]) * style.category_step
        offsets = (np.arange(values.shape[1]) - (values.shape[1] - 1) / 2) * style.bar_pitch
        glyph_dx = (np.arange(motion.cols) - (motion.cols - 1) / 2) * style.glyph_step
        top = values.to_numpy().max() * 1.05

        # Layers, bottom to top: reference lines (7), one mask per bar (10), glyphs (11).
        # The mask cuts the lines where a bar stands. Glyphs carry no boxes of their own:
        # per-glyph boxes overlapped the row below and clipped the tops of its digits.
        dashes, cap = dash_pattern(style)
        # Labels stand in one centred column past the line's end: the word sits on the
        # line, the arrow points to the side of the line the word describes.
        line_end = 0.97                              # axes fraction
        at_line_end = blended_transform_factory(ax.transAxes, ax.transData)
        for y, color, *label in style.hlines:
            ax.axhline(y, xmin=0.03, xmax=line_end, color=to_rgba(color, style.line_alpha),
                       linewidth=style.line_width, dashes=dashes, dash_capstyle=cap, zorder=7)
            word, arrow = (*label, None, None)[:2]
            marks = [(word, 0)] if word else []
            if arrow:
                marks.append(({'up': '↑', 'down': '↓'}[arrow], {'up': 10, 'down': -10}[arrow]))
            for text, dy in marks:
                ax.annotate(text, (line_end, y), xycoords=at_line_end, xytext=(style.label_dx, dy),
                            textcoords='offset points', ha='center', va='center', fontsize=8,
                            color=style.label_color, zorder=12, annotation_clip=False)

        self.bars, self.masks = [], []
        for i, category in enumerate(values.index):
            for g, group in enumerate(values.columns):
                bar = build_bar(values.loc[category, group], row_value, motion, rng)
                cx, width = x[i] + offsets[g], motion.cols * style.glyph_step
                mask = Rectangle((cx - width / 2, 0), width, bar.n_rows * row_value,
                                 facecolor=style.background, edgecolor='none', zorder=10)
                ax.add_patch(mask)
                texts = [[ax.text(cx + dx, r * row_value, '', fontsize=style.glyph_size,
                                  ha='center', va='bottom', zorder=11)
                          for dx in glyph_dx] for r in range(bar.n_rows)]
                self.bars.append((bar, np.array(to_rgb(style.colors[g])), texts))
                self.masks.append(mask)

        ax.set_xlim(x[0] - 0.41, x[-1] + 0.41)
        ax.set_ylim(0, top)
        thresholds = {y for y, *_ in style.hlines}
        ax.set_yticks(sorted({*(t for t in ax.get_yticks() if 0 <= t <= top), *thresholds}))
        ax.set_xticks(x, values.index)
        ax.set_xlabel(style.xlabel)
        ax.set_ylabel(style.ylabel)
        self.fig.suptitle(style.title)
        # The subtitle doubles as the legend, so the plot carries no legend box.
        self.key = AnchoredOffsetbox(loc='lower center', child=_subtitle_key(values.columns, style),
                                     pad=0, borderpad=0.6, frameon=False,
                                     bbox_to_anchor=(0.5, 1.0), bbox_transform=ax.transAxes)
        ax.add_artist(self.key)

    def update(self, f):
        for bar, rgb, texts in self.bars:
            state = frame_state(bar, f, self.motion)
            rgb_now = rgb + (1 - rgb) * self.motion.whiten * state.sparkle[..., None]
            for r, row in enumerate(texts):
                for c, text in enumerate(row):
                    text.set_text(state.chars[r, c].translate(self.glyph_map))
                    text.set_color((*rgb_now[r, c], state.alpha[r, c]))


def _ffmpeg(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *map(str, args)], check=True)


def still(values, out, style=Style(), motion=Motion(), row_value=None, seed=None, width=2400):
    """Write frame 0 as <out>.png and <out>.svg."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    row_value = row_value or values.to_numpy().max() / 63
    paths = {k: out.with_suffix('.' + k) for k in ('png', 'svg')}
    with plt.rc_context(style.rc()):
        chart = Chart(values, style, motion, row_value, np.random.default_rng(seed))
        chart.update(0)
        for path in paths.values():
            chart.fig.savefig(path, dpi=width / style.figsize[0])
        plt.close(chart.fig)
    return paths


def render(values, out, style=Style(), motion=Motion(), row_value=None, seed=None,
           still_width=2400, video_width=1920, gif_width=1200, gif_colors=128, loops=3):
    """Write <out>.png (frame 0), <out>.mp4 (`loops` loops) and <out>.gif (loops forever)."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    row_value = row_value or values.to_numpy().max() / 63     # tallest bar gets 63 rows
    inches = style.figsize[0]
    paths = {k: out.with_suffix('.' + k) for k in ('png', 'mp4', 'gif')}

    with plt.rc_context(style.rc()), tempfile.TemporaryDirectory() as tmp:
        chart = Chart(values, style, motion, row_value, np.random.default_rng(seed))
        chart.update(0)
        chart.fig.savefig(paths['png'], dpi=still_width / inches)
        for f in range(motion.frames):
            chart.update(f)
            chart.fig.savefig(f'{tmp}/{f:04d}.png', dpi=video_width / inches)
        plt.close(chart.fig)

        frames_in = ('-framerate', motion.fps, '-i', f'{tmp}/%04d.png')
        _ffmpeg(*frames_in,
                '-vf', f'loop=loop={loops - 1}:size={motion.frames}:start=0,format=yuv420p',
                '-c:v', 'libx264', '-crf', 18, '-preset', 'slow', '-movflags', '+faststart',
                paths['mp4'])
        _ffmpeg(*frames_in,
                # 128 colours look the same as 256 here and keep 192 frames under LinkedIn's
                # 5 MB; diff_mode re-encodes only the rectangle that changed between frames.
                '-vf', f'scale={gif_width}:-2:flags=lanczos,split[a][b];'
                       f'[a]palettegen=stats_mode=full:max_colors={gif_colors}[p];'
                       '[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
                '-loop', 0, paths['gif'])
    return paths


# ---------------------------------------------------------------- command line

def main(argv=None):
    p = argparse.ArgumentParser(description='Bar chart built from ones and zeros: PNG, MP4 and GIF.')
    p.add_argument('csv', help='columns: category, group, value')
    p.add_argument('--out', default='binary_bars', help='output path without extension')
    p.add_argument('--title', default='')
    p.add_argument('--xlabel', default='')
    p.add_argument('--ylabel', default='')
    p.add_argument('--colors', help='comma-separated hex, one per group')
    p.add_argument('--hline', action='append', default=[], metavar='VALUE:COLOR[:LABEL[:up|down]]',
                   help='reference line with a y tick, an optional label and arrow; repeatable')
    p.add_argument('--line-style', choices=sorted(LINE_STYLES), default=Style.line_style)
    p.add_argument('--glyphs', default=Style.glyphs,
                   help='two symbols that stand in for 1 and 0, e.g. zZ for sleep or $+ for sales')
    p.add_argument('--still-only', action='store_true', help='write <out>.png and <out>.svg only')
    p.add_argument('--row-value', type=float, help='data units per glyph row (default: tallest bar = 63 rows)')
    p.add_argument('--seed', type=int, help='fix the bits; omit for new bits on every run')
    p.add_argument('--frames', type=int, default=Motion.frames)
    p.add_argument('--fps', type=float, default=Motion.fps)
    args = p.parse_args(argv)

    style = Style(
        title=args.title, xlabel=args.xlabel, ylabel=args.ylabel,
        hlines=tuple((float(v), *rest) for v, *rest in (h.split(':', 3) for h in args.hline)),
        line_style=args.line_style,
        glyphs=args.glyphs,
        **({'colors': tuple(args.colors.split(','))} if args.colors else {}),
    )
    motion = Motion(frames=args.frames, fps=args.fps)
    if args.still_only:
        paths = still(load_values(args.csv), args.out, style, motion, row_value=args.row_value, seed=args.seed)
    else:
        paths = render(load_values(args.csv), args.out, style, motion,
                       row_value=args.row_value, seed=args.seed)
    print('\n'.join(map(str, paths.values())))


if __name__ == '__main__':
    main()
