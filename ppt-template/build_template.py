#!/usr/bin/env python3
"""Build the "1Fit x KOL" PowerPoint template.

The design is reverse-engineered from ``1Fit x KOLs Collabs 2025.pdf`` (a Canva
deck, 1440 x 810 pt).  Every measurement below is the original Canva coordinate
divided by 108, which maps the 20 x 11.25 in Canva page onto a standard
13.333 x 7.5 in PowerPoint widescreen slide.

Outputs (written to ``dist/``):

* ``1Fit-KOL-Template.pptx`` - 14 sample slides, one per layout
* ``1Fit-KOL-Template.potx`` - the same master/layouts with no slides

Usage::

    python3 build_template.py
    python3 build_template.py --heading-font "League Spartan" --body-font Poppins
"""

from __future__ import annotations

import argparse
import copy
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.opc.packuri import PackURI
from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls, qn
from pptx.util import Emu, Inches

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
DIST = HERE / "dist"

SLIDE_W_IN = 13.3333
SLIDE_H_IN = 7.5

# --------------------------------------------------------------------------- #
# Brand tokens
# --------------------------------------------------------------------------- #

INK = "000000"        # headings
BODY = "333333"       # body copy
GREY = "8E8E93"       # captions / muted
BLUE = "524EDE"       # 1Fit brand blue
NAVY = "0032A2"       # deep blue (annotation arrows)
TEAL = "5CE1E6"       # highlight arrows
RED = "FF3131"        # do-not / restriction copy
WHITE = "FFFFFF"
SCREEN_BG = "F2F2F4"  # empty phone screen

HEADING_FONT = "League Spartan"
BODY_FONT = "Poppins"

# Type scale in points, already converted from the Canva sizes.
SZ_DISPLAY = 44   # cover headline          (Canva 66)
SZ_H1 = 33        # section headline        (Canva 49)
SZ_H2 = 29        # page headline           (Canva 44)
SZ_H3 = 26        # multi-line headline     (Canva 39)
SZ_LEAD = 20      # emphasised lead-in      (Canva 30)
SZ_LIST = 18      # list copy               (Canva 27)
SZ_BODY = 17      # dense body copy         (Canva 26)
SZ_SMALL = 15     # small body / captions   (Canva 23)
SZ_MICRO = 12.5   # side lists              (Canva 19)

# --------------------------------------------------------------------------- #
# Phone mock-up geometry (measured from the transparent frame PNG, 285 x 549 px)
# --------------------------------------------------------------------------- #

PHONE_RATIO = 285 / 549          # frame width / frame height
SCREEN_X = 24 / 285              # screen inset, as a fraction of the frame
SCREEN_Y = 22 / 549
SCREEN_W = 235 / 285
SCREEN_H = 507 / 549


class Phone:
    """A phone frame placed on a slide, plus the screen rect inside it."""

    def __init__(self, left: float, top: float, height: float):
        self.left = left
        self.top = top
        self.height = height
        self.width = height * PHONE_RATIO

    @property
    def screen(self) -> tuple[float, float, float, float]:
        return (
            self.left + self.width * SCREEN_X,
            self.top + self.height * SCREEN_Y,
            self.width * SCREEN_W,
            self.height * SCREEN_H,
        )


# --------------------------------------------------------------------------- #
# XML helpers
# --------------------------------------------------------------------------- #

NS = nsdecls("a", "p", "r")


def _emu(inches: float) -> int:
    return int(Emu(Inches(inches)))


def _sz(points: float) -> int:
    return int(round(points * 100))


def _xfrm(left: float, top: float, width: float, height: float) -> str:
    return (
        f'<a:xfrm><a:off x="{_emu(left)}" y="{_emu(top)}"/>'
        f'<a:ext cx="{_emu(width)}" cy="{_emu(height)}"/></a:xfrm>'
    )


def _def_rpr(
    size: float,
    *,
    bold: bool = False,
    color: str = BODY,
    font: str = "+mn-lt",
    spc: int | None = None,
) -> str:
    spc_attr = f' spc="{spc}"' if spc is not None else ""
    return (
        f'<a:defRPr sz="{_sz(size)}" b="{int(bold)}"{spc_attr} kern="1200">'
        f"<a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill>"
        f'<a:latin typeface="{font}"/><a:cs typeface="{font}"/>'
        "</a:defRPr>"
    )


def _lvl_ppr(
    level: int,
    size: float,
    *,
    bold: bool = False,
    color: str = BODY,
    font: str = "+mn-lt",
    line: float = 1.25,
    gap: float = 0.0,
    align: str = "l",
    bullet: str | None = None,
    indent: float = 0.32,
    spc: int | None = None,
) -> str:
    """One ``a:lvlNpPr`` entry for a placeholder's ``a:lstStyle``.

    ``line`` is a multiple of the font size and is written out as an absolute
    ``spcPts`` leading: percentage leading is resolved against each font's own
    default line height, which drifts between PowerPoint, Keynote and Google
    Slides, whereas absolute leading reproduces the Canva original everywhere.
    """
    if bullet == "dot":
        mar = f' marL="{_emu(indent)}" indent="{-_emu(indent)}"'
        bu = '<a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="&#8226;"/>'
    elif bullet == "number":
        mar = f' marL="{_emu(indent)}" indent="{-_emu(indent)}"'
        bu = '<a:buFont typeface="+mn-lt"/><a:buAutoNum type="arabicPeriod"/>'
    else:
        mar = ' marL="0" indent="0"'
        bu = "<a:buNone/>"
    return (
        f'<a:lvl{level}pPr{mar} algn="{align}">'
        f'<a:lnSpc><a:spcPts val="{_sz(line * size)}"/></a:lnSpc>'
        f'<a:spcBef><a:spcPts val="{_sz(gap)}"/></a:spcBef>'
        f"{bu}{_def_rpr(size, bold=bold, color=color, font=font, spc=spc)}"
        f"</a:lvl{level}pPr>"
    )


def _body_pr(anchor: str = "t", autofit: bool = True) -> str:
    fit = "<a:normAutofit/>" if autofit else "<a:noAutofit/>"
    return (
        f'<a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" '
        f'rtlCol="0" anchor="{anchor}">{fit}</a:bodyPr>'
    )


def placeholder(
    shape_id: int,
    name: str,
    ph_type: str,
    left: float,
    top: float,
    width: float,
    height: float,
    *,
    idx: int | None = None,
    prompt: str | list[str] = "",
    levels: str = "",
    anchor: str = "t",
    autofit: bool = True,
) -> str:
    """A text placeholder ``p:sp`` for a slide layout."""
    idx_attr = f' idx="{idx}"' if idx is not None else ""
    prompts = [prompt] if isinstance(prompt, str) else prompt
    paras = "".join(
        f'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>{escape(p)}</a:t></a:r></a:p>'
        for p in prompts
    ) or "<a:p/>"
    return f"""<p:sp {NS}>
  <p:nvSpPr>
    <p:cNvPr id="{shape_id}" name="{escape(name)}"/>
    <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
    <p:nvPr><p:ph type="{ph_type}"{idx_attr} hasCustomPrompt="1"/></p:nvPr>
  </p:nvSpPr>
  <p:spPr>{_xfrm(left, top, width, height)}</p:spPr>
  <p:txBody>
    {_body_pr(anchor=anchor, autofit=autofit)}
    <a:lstStyle>{levels}</a:lstStyle>
    {paras}
  </p:txBody>
</p:sp>"""


def picture_placeholder(
    shape_id: int,
    name: str,
    idx: int,
    left: float,
    top: float,
    width: float,
    height: float,
    *,
    rounded: float | None = None,
) -> str:
    """A picture placeholder, optionally with rounded corners (phone screens)."""
    if rounded is None:
        geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    else:
        adj = int(round(rounded / min(width, height) * 100000))
        geom = f'<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst></a:prstGeom>'
    return f"""<p:sp {NS}>
  <p:nvSpPr>
    <p:cNvPr id="{shape_id}" name="{escape(name)}"/>
    <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
    <p:nvPr><p:ph type="pic" idx="{idx}" hasCustomPrompt="1"/></p:nvPr>
  </p:nvSpPr>
  <p:spPr>
    {_xfrm(left, top, width, height)}
    {geom}
    <a:solidFill><a:srgbClr val="{SCREEN_BG}"/></a:solidFill>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" lIns="45720" tIns="45720" rIns="45720" bIns="45720" anchor="ctr"/>
    <a:lstStyle>{_lvl_ppr(1, SZ_MICRO, color=GREY, align="ctr", line=1.2)}</a:lstStyle>
    <a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/><a:t>\u70b9\u51fb\u63d2\u5165\u622a\u56fe</a:t></a:r></a:p>
  </p:txBody>
</p:sp>"""


def rect(
    shape_id: int,
    name: str,
    left: float,
    top: float,
    width: float,
    height: float,
    *,
    fill: str | None = None,
    rounded: float | None = None,
) -> str:
    if rounded is None:
        geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    else:
        adj = int(round(rounded / min(width, height) * 100000))
        geom = f'<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val {adj}"/></a:avLst></a:prstGeom>'
    fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
    return f"""<p:sp {NS}>
  <p:nvSpPr>
    <p:cNvPr id="{shape_id}" name="{escape(name)}"/>
    <p:cNvSpPr/><p:nvPr/>
  </p:nvSpPr>
  <p:spPr>{_xfrm(left, top, width, height)}{geom}{fill_xml}<a:ln><a:noFill/></a:ln></p:spPr>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
</p:sp>"""


def picture(shape_id: int, name: str, r_id: str, left: float, top: float, width: float, height: float) -> str:
    return f"""<p:pic {NS}>
  <p:nvPicPr>
    <p:cNvPr id="{shape_id}" name="{escape(name)}"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill><a:blip r:embed="{r_id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr>{_xfrm(left, top, width, height)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>"""


def layout_xml(name: str, shapes: list[str], *, layout_type: str = "obj") -> str:
    body = "\n".join(shapes)
    return f"""<p:sldLayout {NS} type="{layout_type}" preserve="1">
  <p:cSld name="{escape(name)}">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>
        <a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      {body}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"""


# --------------------------------------------------------------------------- #
# Theme + master
# --------------------------------------------------------------------------- #

THEME_COLORS = [
    ("dk1", INK),
    ("lt1", WHITE),
    ("dk2", BODY),
    ("lt2", SCREEN_BG),
    ("accent1", BLUE),
    ("accent2", NAVY),
    ("accent3", TEAL),
    ("accent4", RED),
    ("accent5", INK),
    ("accent6", GREY),
    ("hlink", BLUE),
    ("folHlink", NAVY),
]


def restyle_theme(theme_part, heading_font: str, body_font: str) -> None:
    """Swap the colour and font schemes of the stock theme for the 1Fit ones."""
    theme_element = parse_xml(theme_part.blob)
    theme_element.set("name", "1Fit")
    scheme = theme_element.find(qn("a:themeElements"))
    clr_scheme = scheme.find(qn("a:clrScheme"))
    clr_scheme.set("name", "1Fit")
    for key, value in THEME_COLORS:
        node = clr_scheme.find(qn(f"a:{key}"))
        for child in list(node):
            node.remove(child)
        if key in ("dk1", "lt1"):
            # dk1/lt1 use sysClr in the stock theme; a plain srgbClr is valid too.
            node.append(parse_xml(f'<a:srgbClr {nsdecls("a")} val="{value}"/>'))
        else:
            node.append(parse_xml(f'<a:srgbClr {nsdecls("a")} val="{value}"/>'))

    font_scheme = scheme.find(qn("a:fontScheme"))
    font_scheme.set("name", "1Fit")
    for tag, typeface in (("a:majorFont", heading_font), ("a:minorFont", body_font)):
        node = font_scheme.find(qn(tag))
        node.find(qn("a:latin")).set("typeface", typeface)
        node.find(qn("a:ea")).set("typeface", "")
        node.find(qn("a:cs")).set("typeface", "")

    theme_part._blob = etree.tostring(
        theme_element, xml_declaration=True, encoding="UTF-8", standalone=True
    )


def master_xml(heading_font: str, body_font: str) -> str:
    def txt_style(tag: str, size: float, bold: bool, color: str, font: str) -> str:
        levels = "".join(
            _lvl_ppr(i, size, bold=bold, color=color, font=font, line=1.25)
            for i in range(1, 10)
        )
        return f"<p:{tag}>{levels}</p:{tag}>"

    return f"""<p:sldMaster {NS}>
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="{WHITE}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>
        <a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      {placeholder(2, "Title", "title", 1.0, 0.66, 11.33, 1.0,
                   prompt="Master title",
                   levels=_lvl_ppr(1, SZ_H2, bold=True, color=INK, font="+mj-lt", line=1.0))}
      {placeholder(3, "Body", "body", 1.0, 1.9, 11.33, 4.6, idx=1,
                   prompt="Master body",
                   levels="".join(_lvl_ppr(i, SZ_BODY, color=BODY, line=1.45, gap=6)
                                  for i in range(1, 10)))}
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
            accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"
            hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst/>
  <p:txStyles>
    {txt_style("titleStyle", SZ_H2, True, INK, "+mj-lt")}
    {txt_style("bodyStyle", SZ_BODY, False, BODY, "+mn-lt")}
    {txt_style("otherStyle", SZ_BODY, False, BODY, "+mn-lt")}
  </p:txStyles>
</p:sldMaster>"""


# --------------------------------------------------------------------------- #
# Layout definitions
# --------------------------------------------------------------------------- #

# Leading multiples measured off the original deck.
LEAD_TIGHT = 1.00    # single-line display type
LEAD_HEAD = 1.27     # multi-line headlines
LEAD_DENSE = 1.36    # side lists
LEAD_BODY = 1.45     # normal body copy and bullet lists
LEAD_AIRY = 1.78     # the long numbered lists


def text_ph(
    shape_id: int,
    name: str,
    ph_type: str,
    left: float,
    top: float,
    width: float,
    height: float,
    *,
    size: float,
    idx: int | None = None,
    prompt: str | list[str] = "",
    bold: bool = False,
    color: str = BODY,
    font: str = "+mn-lt",
    line: float = LEAD_BODY,
    gap: float = 0.0,
    align: str = "l",
    bullet: str | None = None,
    indent: float = 0.32,
    spc: int | None = None,
    anchor: str = "t",
) -> str:
    """A text placeholder whose nine outline levels all share one look.

    ``top`` is where the first line of text should sit.  Paragraph spacing also
    applies to the first paragraph, so the box itself is lifted by ``gap`` to
    keep that first line on the intended baseline.
    """
    levels = "".join(
        _lvl_ppr(i, size, bold=bold, color=color, font=font, line=line, gap=gap,
                 align=align, bullet=bullet, indent=indent, spc=spc)
        for i in range(1, 10)
    )
    return placeholder(shape_id, name, ph_type, left, top - gap / 72.0,
                       width, height + gap / 72.0, idx=idx, prompt=prompt,
                       levels=levels, anchor=anchor)


def heading(shape_id: int, name: str, left: float, top: float, width: float,
            height: float, *, size: float, prompt: str | list[str],
            line: float = LEAD_TIGHT, align: str = "l") -> str:
    return text_ph(shape_id, name, "title", left, top, width, height,
                   size=size, prompt=prompt, bold=True, color=INK, font="+mj-lt",
                   line=line, align=align, spc=-20)


def build_layouts() -> list[dict]:
    """Return one dict per layout: display name, shape XML and phone frames."""
    layouts: list[dict] = []

    # -- 1. Cover ----------------------------------------------------------- #
    layouts.append(dict(
        name="01 \u5c01\u9762 Cover",
        type="title",
        phones=[Phone(7.64, 2.55, 8.99)],
        shapes=[
            text_ph(10, "Cover Title", "ctrTitle", 1.55, 2.62, 5.6, 0.95,
                    size=SZ_DISPLAY, prompt="1Fit App", bold=True, color=INK,
                    font="+mj-lt", line=LEAD_TIGHT, spc=-30),
            text_ph(11, "Cover Subtitle", "subTitle", 1.55, 3.48, 5.6, 0.72, idx=1,
                    size=SZ_H1, prompt="KOL Collab", bold=True, color=INK,
                    font="+mj-lt", line=LEAD_TIGHT, spc=-20),
            text_ph(12, "Cover Kicker", "body", 1.55, 4.08, 5.6, 1.10, idx=2,
                    size=SZ_SMALL, line=1.29, color=INK,
                    prompt=["INFLUENCER", "CONTENT CREATION", "GUIDE-ISHHH"]),
        ],
    ))

    # -- 2. Title + body, phone bleeding in from the right ------------------- #
    layouts.append(dict(
        name="02 \u6807\u9898\u6b63\u6587 \u00b7 \u53f3\u624b\u673a",
        phones=[Phone(8.51, 3.36, 7.63)],
        shapes=[
            heading(10, "Title", 1.01, 1.72, 6.8, 0.72, size=SZ_H1, prompt="About 1Fit"),
            text_ph(11, "Body", "body", 1.01, 2.54, 6.9, 2.10, idx=1, size=SZ_SMALL,
                    line=1.39, gap=14,
                    prompt="\u4e00\u6bb5\u7b80\u77ed\u7684\u4ecb\u7ecd\u6587\u5b57\u3002"
                           "\u5173\u952e\u6570\u636e\u52a0\u7c97\uff0c\u5176\u4f59\u4fdd"
                           "\u6301\u5e38\u89c4\u5b57\u91cd\u3002"),
        ],
    ))

    # -- 3. Title + body + side list ----------------------------------------- #
    layouts.append(dict(
        name="03 \u6807\u9898\u6b63\u6587 \u00b7 \u53f3\u4fa7\u6e05\u5355",
        phones=[Phone(8.32, 2.82, 6.55)],
        shapes=[
            text_ph(10, "Side List", "body", 8.74, 0.52, 4.0, 2.40, idx=3,
                    size=SZ_MICRO, line=LEAD_DENSE, bullet="dot", indent=0.22,
                    prompt=["Gym", "Yoga", "Martial Arts", "Pickleballs", "Bouldering"]),
            heading(11, "Title", 1.32, 2.35, 6.6, 0.78, size=SZ_H2,
                    prompt="We\u2019re in Malaysia!"),
            text_ph(12, "Body", "body", 1.32, 3.08, 6.6, 2.40, idx=1, size=SZ_SMALL,
                    line=1.39, gap=21,
                    prompt="\u6b63\u6587\u6bb5\u843d\u4e00\u3002\n"
                           "\u6b63\u6587\u6bb5\u843d\u4e8c\uff0c\u53ef\u4ee5\u5199"
                           "\u5dee\u5f02\u5316\u5356\u70b9\u3002"),
        ],
    ))

    # -- 4. Title + body right, two phones bleeding in from the left --------- #
    layouts.append(dict(
        name="04 \u6807\u9898\u6b63\u6587 \u00b7 \u5de6\u53cc\u624b\u673a",
        phones=[Phone(-0.40, 1.08, 5.20), Phone(2.30, 1.07, 5.22)],
        shapes=[
            heading(10, "Title", 6.92, 1.30, 5.60, 0.72, size=SZ_H1, prompt="Our socials"),
            text_ph(11, "Body", "body", 6.92, 2.12, 5.60, 3.30, idx=1, size=SZ_SMALL,
                    line=1.48, gap=22,
                    prompt="\u6bb5\u843d\u4e00\u3002\n\u6bb5\u843d\u4e8c\uff0c\u53ef\u7528"
                           "\u54c1\u724c\u84dd\u8272\u5f3a\u8c03\u5173\u952e\u8bcd\u3002"),
        ],
    ))

    # -- 5. Centred title, two phones, numbered list ------------------------- #
    layouts.append(dict(
        name="05 \u5c45\u4e2d\u6807\u9898 \u00b7 \u53cc\u624b\u673a\u5217\u8868",
        phones=[Phone(0.76, 1.26, 4.88), Phone(10.00, 1.26, 4.88)],
        shapes=[
            heading(10, "Title", 0.0, 0.70, SLIDE_W_IN, 0.78, size=SZ_H2,
                    prompt="Content Message", align="ctr"),
            text_ph(11, "Lead-in", "body", 3.71, 1.95, 5.40, 0.90, idx=2,
                    size=SZ_SMALL, bold=True, line=1.78,
                    prompt="\u5f15\u5bfc\u53e5\uff0c\u4e24\u884c\u4ee5\u5185\u3002"),
            text_ph(12, "Numbered List", "body", 4.07, 3.10, 5.30, 2.70, idx=1,
                    size=SZ_SMALL, line=LEAD_AIRY, bullet="number", indent=0.26,
                    prompt="\u8981\u70b9\u4e00\n\u8981\u70b9\u4e8c\n\u8981\u70b9\u4e09"),
        ],
    ))

    # -- 6. Phone left + title/subtitle/list + caption ----------------------- #
    layouts.append(dict(
        name="06 \u5de6\u624b\u673a \u00b7 \u53f3\u5185\u5bb9\u5217\u8868",
        phones=[Phone(1.24, 0.57, 5.87)],
        shapes=[
            text_ph(10, "Caption", "body", 1.24, 6.57, 3.30, 0.75, idx=3,
                    size=SZ_SMALL, color=GREY, line=1.48,
                    prompt=["Click image to watch", "(sample only)"]),
            heading(11, "Title", 4.96, 1.06, 7.60, 0.72, size=SZ_H2,
                    prompt="Content Reference"),
            text_ph(12, "Subtitle", "body", 4.96, 1.78, 7.60, 0.48, idx=2,
                    size=SZ_LIST, bold=True, line=LEAD_TIGHT,
                    prompt="One Activity Experience"),
            text_ph(13, "List", "body", 4.96, 2.52, 7.60, 3.30, idx=1,
                    size=SZ_LIST, line=1.49, bullet="dot", indent=0.28,
                    prompt="Video Flow:\n\u6b65\u9aa4\u4e00\n\u6b65\u9aa4\u4e8c\n"
                           "\u6b65\u9aa4\u4e09"),
        ],
    ))

    # -- 7. Phone left + two-column list ------------------------------------- #
    layouts.append(dict(
        name="07 \u5de6\u624b\u673a \u00b7 \u53cc\u680f\u6e05\u5355",
        phones=[Phone(1.00, 0.60, 6.08)],
        shapes=[
            heading(10, "Title", 5.19, 0.70, 7.40, 1.55, size=SZ_H3,
                    line=LEAD_HEAD, prompt=["Hotspots of", "Gyms & studios"]),
            text_ph(11, "Column 1", "body", 5.19, 2.28, 3.00, 3.30, idx=1,
                    size=SZ_LIST, line=1.48,
                    prompt="\u9879\u76ee\u4e00\n\u9879\u76ee\u4e8c\n\u9879\u76ee\u4e09"),
            text_ph(12, "Column 2", "body", 8.21, 2.28, 4.20, 3.30, idx=2,
                    size=SZ_LIST, line=1.48,
                    prompt="\u9879\u76ee\u56db\n\u9879\u76ee\u4e94\n\u9879\u76ee\u516d"),
            text_ph(13, "Footnote", "body", 5.19, 6.36, 7.40, 0.50, idx=3,
                    size=SZ_LIST, bold=True, line=LEAD_TIGHT,
                    prompt="\u5c0f\u7ed3\u4e00\u53e5\u8bdd\u3002"),
        ],
    ))

    # -- 8. Phone left + rules + red restriction block ----------------------- #
    restriction_levels = _lvl_ppr(1, SZ_LEAD, bold=True, color=RED, line=1.49) + "".join(
        _lvl_ppr(i, SZ_LEAD, bold=True, color=RED, line=1.49, bullet="dot", indent=0.28)
        for i in range(2, 10)
    )
    layouts.append(dict(
        name="08 \u5de6\u624b\u673a \u00b7 \u89c4\u5219\u4e0e\u7981\u4ee4",
        phones=[Phone(1.00, 0.60, 6.08)],
        shapes=[
            heading(10, "Title", 4.86, 0.68, 7.70, 0.62, size=SZ_H3,
                    prompt="Gyms & Studios Regulations"),
            text_ph(11, "Rules", "body", 4.86, 1.44, 7.70, 1.75, idx=1,
                    size=SZ_LIST, line=1.48, bullet="dot", indent=0.28,
                    prompt="\u89c4\u5219\u4e00\n\u89c4\u5219\u4e8c\n\u89c4\u5219\u4e09"),
            placeholder(12, "Restrictions", "body", 4.86, 3.50, 7.70, 2.90, idx=2,
                        prompt=["\u7981\u6b62\u62cd\u6444\u7684\u573a\u9986\uff1a",
                                "\u573a\u9986 A", "\u573a\u9986 B"],
                        levels=restriction_levels),
        ],
    ))

    # -- 9. Text left + free image right ------------------------------------- #
    layouts.append(dict(
        name="09 \u5de6\u6587 \u00b7 \u53f3\u5927\u56fe",
        phones=[],
        shapes=[
            rect(9, "Image Frame", 6.91, 1.16, 6.00, 5.20, fill=SCREEN_BG, rounded=0.12),
            heading(10, "Title", 0.66, 1.54, 5.70, 0.72, size=SZ_H2, prompt="The Caption"),
            text_ph(11, "Body", "body", 0.66, 2.30, 5.90, 2.90, idx=1, size=SZ_BODY,
                    line=1.49, bullet="dot", indent=0.28,
                    prompt="\u8981\u70b9\u4e00\n\u8981\u70b9\u4e8c\n\u8981\u70b9\u4e09"),
            picture_placeholder(12, "Screenshot", 4, 6.91, 1.16, 6.00, 5.20, rounded=0.12),
        ],
    ))

    # -- 10. Text left + two portrait phones --------------------------------- #
    layouts.append(dict(
        name="10 \u5de6\u6587 \u00b7 \u53cc\u624b\u673a\u6f14\u793a",
        phones=[Phone(4.99, 0.29, 6.93), Phone(8.58, 0.23, 6.93)],
        shapes=[
            heading(10, "Title", 0.66, 1.54, 4.20, 0.72, size=SZ_H2,
                    prompt="The Promo Code"),
            text_ph(11, "Body", "body", 0.66, 2.30, 4.20, 2.90, idx=1, size=SZ_BODY,
                    line=1.49, bullet="dot", indent=0.28,
                    prompt="\u6b65\u9aa4\u4e00\n\u6b65\u9aa4\u4e8c\n\u6b65\u9aa4\u4e09"),
        ],
    ))

    # -- 11. Centred title + pull quote inside a phone ----------------------- #
    quote_phone = Phone(3.62, 1.20, 11.20)
    quote_left, _, quote_w, _ = quote_phone.screen
    layouts.append(dict(
        name="11 \u5c45\u4e2d\u6807\u9898 \u00b7 \u624b\u673a\u5185\u5f15\u8a00",
        phones=[quote_phone],
        phone_screen_placeholder=False,
        shapes=[
            heading(10, "Title", 0.0, 0.62, SLIDE_W_IN, 0.78, size=SZ_H2,
                    prompt="A very very friendly reminder", align="ctr"),
            text_ph(11, "Quote", "body", quote_left + 0.35, 2.32, quote_w - 0.70, 2.10,
                    idx=1, size=SZ_BODY, line=1.49, align="r",
                    prompt="\u5f15\u8a00\u6587\u5b57\uff0c\u53f3\u5bf9\u9f50\u3002"),
            text_ph(12, "Attribution", "body", quote_left + 0.35, 4.78, quote_w - 0.70,
                    0.45, idx=2, size=SZ_BODY, line=LEAD_TIGHT, align="r",
                    prompt="-1Fit Marketing Team"),
        ],
    ))

    # -- 12. Title left + long numbered steps -------------------------------- #
    layouts.append(dict(
        name="12 \u5de6\u6807\u9898 \u00b7 \u53f3\u7f16\u53f7\u6b65\u9aa4",
        phones=[Phone(-1.31, 4.30, 8.15)],
        phone_screen_placeholder=False,
        shapes=[
            heading(10, "Title", 0.55, 2.46, 2.60, 1.40, size=SZ_H2,
                    line=LEAD_HEAD, prompt=["How do", "we start"]),
            text_ph(11, "Steps", "body", 3.19, 0.86, 9.45, 5.95, idx=1, size=SZ_BODY,
                    line=1.90, bullet="number", indent=0.30,
                    prompt="\u6b65\u9aa4\u4e00\n\u6b65\u9aa4\u4e8c\n\u6b65\u9aa4\u4e09"),
        ],
    ))

    # -- 13. Closing ---------------------------------------------------------- #
    layouts.append(dict(
        name="13 \u7ed3\u5c3e\u9875 Closing",
        phones=[Phone(7.64, 2.55, 8.99)],
        shapes=[
            heading(10, "Title", 1.55, 3.34, 5.60, 0.82, size=31, prompt="Any questions?"),
            text_ph(11, "Body", "body", 1.55, 4.22, 5.60, 0.52, idx=1, size=SZ_LIST,
                    line=LEAD_TIGHT, prompt="Just let us know ;P"),
        ],
    ))

    # -- 14. Blank ------------------------------------------------------------ #
    layouts.append(dict(name="14 \u7a7a\u767d Blank", phones=[], shapes=[]))

    return layouts



# --------------------------------------------------------------------------- #
# Package assembly
# --------------------------------------------------------------------------- #

def build_base(path: Path, heading_font: str, body_font: str) -> None:
    """Write a presentation containing only the 1Fit theme, master and layouts."""
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W_IN)
    prs.slide_height = Inches(SLIDE_H_IN)

    master = prs.slide_masters[0]
    master_part = master.part

    restyle_theme(master_part.part_related_by(RT.THEME), heading_font, body_font)

    definitions = build_layouts()

    # Reuse the 11 stock layout parts and clone extra parts for the rest.
    stock_parts = [lay.part for lay in master.slide_layouts]
    layout_parts = list(stock_parts)
    template_part = stock_parts[-1]
    for n in range(len(stock_parts), len(definitions)):
        uri = PackURI(f"/ppt/slideLayouts/slideLayout{n + 1}.xml")
        clone = type(template_part)(
            uri, template_part.content_type, template_part.package,
            copy.deepcopy(template_part._element),
        )
        clone.relate_to(master_part, RT.SLIDE_MASTER)
        layout_parts.append(clone)

    # Rebuild the master with 1Fit styling, then re-attach every layout.
    new_master = parse_xml(master_xml(heading_font, body_font))
    master_part._element = new_master
    layout_id_lst = new_master.find(qn("p:sldLayoutIdLst"))

    for index, (definition, part) in enumerate(zip(definitions, layout_parts)):
        shapes = list(definition["shapes"])
        shape_id = 60
        wants_screen_ph = definition.get("phone_screen_placeholder", True)
        for phone in definition.get("phones", []):
            sx, sy, sw, sh = phone.screen
            radius = phone.width * 0.115
            # A plain rect behind the placeholder: PowerPoint hides a layout's
            # placeholder once a slide inherits it, so the tint that marks the
            # drop zone has to come from a non-placeholder shape.
            backing = rect(shape_id, f"Phone Screen {shape_id}", sx, sy, sw, sh,
                           fill=SCREEN_BG if wants_screen_ph else WHITE, rounded=radius)
            shape_id += 1
            extra = [backing]
            if wants_screen_ph:
                extra.append(picture_placeholder(
                    shape_id, f"Phone Screenshot {shape_id}", 10 + shape_id,
                    sx, sy, sw, sh, rounded=radius,
                ))
                shape_id += 1
            shapes[:0] = extra

        element = parse_xml(layout_xml(definition["name"], shapes,
                                       layout_type=definition.get("type", "obj")))
        part._element = element

        # Phone frames sit on top of the screen fill but under any slide content.
        tree = element.find(qn("p:cSld")).find(qn("p:spTree"))
        for phone in definition.get("phones", []):
            _, r_id = part.get_or_add_image_part(str(ASSETS / "phone-frame.png"))
            tree.append(parse_xml(picture(
                shape_id, f"Phone Frame {shape_id}", r_id,
                phone.left, phone.top, phone.width, phone.height,
            )))
            shape_id += 1

        r_id = master_part.relate_to(part, RT.SLIDE_LAYOUT)
        entry = parse_xml(
            f'<p:sldLayoutId {nsdecls("p", "r")} id="{2147483649 + index}" r:id="{r_id}"/>'
        )
        layout_id_lst.append(entry)

    prs.save(str(path))


# --------------------------------------------------------------------------- #
# Sample deck
# --------------------------------------------------------------------------- #

def _fill(placeholder_shape, paragraphs) -> None:
    """Write text into a placeholder, keeping the layout's inherited formatting.

    Each entry is either a plain string or a list of ``(text, bold, color)``
    chunks, which is how the original deck mixes weights inside one paragraph.
    """
    frame = placeholder_shape.text_frame
    frame.clear()
    for i, text in enumerate(paragraphs):
        para = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        chunks = [(text, None, None)] if isinstance(text, str) else text
        for chunk, bold, color in chunks:
            run = para.add_run()
            run.text = chunk
            if bold is not None:
                run.font.bold = bold
            if color is not None:
                run.font.color.rgb = RGBColor.from_string(color)


B = True   # bold shorthand for mixed runs
N = None


def add_sample_slides(prs: Presentation) -> None:
    layouts = prs.slide_masters[0].slide_layouts

    def new(index: int):
        return prs.slides.add_slide(layouts[index])

    # 1 - cover
    s = new(0)
    _fill(s.placeholders[0], ["1Fit App"])
    _fill(s.placeholders[1], ["KOL Collab"])
    _fill(s.placeholders[2], ["INFLUENCER", "CONTENT CREATION", "GUIDE-ISHHH"])

    # 2 - about
    s = new(1)
    _fill(s.placeholders[0], ["About 1Fit"])
    _fill(s.placeholders[1], [[
        ("Founded in Kazakhstan in 2018, we\u2019re a fitness app that provides "
         "memberships in ", N, N),
        ("six countries", B, N),
        (" with more than ", N, N),
        ("2M", B, N),
        (" registered users (95% are annual members) & ", N, N),
        ("6.5M", B, N),
        (" training sessions worldwide.", N, N),
    ]])

    # 3 - market
    s = new(2)
    _fill(s.placeholders[3], ["Gym", "Yoga", "Martial Arts", "Pickleballs", "Bouldering",
                              "Recovery & Spa", "Dance", "Horse Riding"])
    _fill(s.placeholders[0], ["We\u2019re in Malaysia!"])
    _fill(s.placeholders[1], [
        [("Launched in January 2024, Malaysia is our first Southeast Asia region "
          "where our users can access over ", N, N),
         ("450+", B, N),
         (" gyms/studios in Klang Valley & Selangor.", N, N)],
        [("Our main differentiation from competitors: our subscription allows almost "
          "unlimited access to the gyms, studios and classes on our platform.", N, N)],
    ])

    # 4 - socials
    s = new(3)
    _fill(s.placeholders[0], ["Our socials"])
    _fill(s.placeholders[1], [
        "We\u2019re on Instagram & TikTok \u2013 consist of our very own content + "
        "influencers & media collab posts etc.",
        [("The vibe is ", N, N),
         ("not just BLUE", B, BLUE),
         (", we\u2019re focusing on fun & trendy content \u2013 engaging with Malaysians "
          "in a relevant and localised manner.", N, N)],
    ])

    # 5 - content message
    s = new(4)
    _fill(s.placeholders[0], ["Content Message"])
    _fill(s.placeholders[2], ["Simple pointers to be mixed in your content",
                              "(we don\u2019t do hard sell)"])
    _fill(s.placeholders[1], [
        [("We offer unlimited membership pass (not credits)", B, N),
         (" \u2013 go anywhere you want.", N, N)],
        [("We have over 450+ locations", B, N), (" \u2013 gyms, studios, classes.", N, N)],
        [("Highlight the convenience & benefits of the app", B, N)],
        [("Highlight the studio/gym/location", B, N), (" that you\u2019re going.", N, N)],
        [("Get a 7-day free trial", B, N), (" (using your promocode).", N, N)],
    ])

    # 6 + 7 - content references
    for subtitle, steps in (
        ("One Activity Experience",
         ["Video Flow:", "Entrance to one location",
          "Introduction of the gym / studio / class",
          "Soft mention of the booking thru 1Fit app",
          "Soft mention of 1Fit USPs (hassle free etc.)",
          "CTA: Download app and get a free trial"]),
        ("Lifestyle Format",
         ["Video Flow:", "Starting with a \u201cday in the life of\u201d\u2026",
          "Slip in that 1Fit is a new addition that\u2019s essential in your life",
          "Highlight the enhanced experience using 1Fit",
          "Visuals of the experience of the workout(s)",
          "CTA: Download app and get a free trial"]),
    ):
        s = new(5)
        _fill(s.placeholders[3], ["Click image to watch", "(sample only ahhh\u2026)"])
        _fill(s.placeholders[0], ["Content Reference"])
        _fill(s.placeholders[2], [subtitle])
        _fill(s.placeholders[1], steps)
        # The lead-in line has no bullet.
        first = s.placeholders[1].text_frame.paragraphs[0]
        first._pPr.insert(0, parse_xml(f'<a:buNone {nsdecls("a")}/>'))

    # 8 - hotspots
    s = new(6)
    _fill(s.placeholders[0], ["Hotspots of", "Gyms & studios that you can",
                              "highlight in your content"])
    _fill(s.placeholders[1], ["FLYPROJECT", "Merican Muay Thai", "Lionheart Wellness",
                              "Manic Studio", "Ozone Fitness", "Liv Studio", "Gym Box",
                              "Oxygen Fitness", "Batuu (Bouldering)"])
    _fill(s.placeholders[2], ["Revery Idealistic (AI-tech Gym)", "ESM Pickters Arena (Pickleball)",
                              "Under The Light Yoga", "SimGolf", "The Active Chimp",
                              "Ouranos Gym", "MyThai (Massages)",
                              "Dayakboi Playground (Archery)", "Momoswim Inc (Watersports)"])
    _fill(s.placeholders[3], ["We have 450+ locations for you to choose from!"])

    # 9 - regulations
    s = new(7)
    _fill(s.placeholders[0], ["Gyms & Studios Regulations"])
    _fill(s.placeholders[1], [
        [("Make sure to ", N, N), ("follow the rules", B, N),
         (" & regulation of the location.", N, N)],
        [("Content shooting in the class/studio has to be ", N, N),
         ("non-disturbance", B, N), (".", N, N)],
        [("We ", N, N), ("don\u2019t have exclusivity", B, N),
         (", everyone will attend as users.", N, N)],
    ])
    _fill(s.placeholders[2], ["List of locations that don\u2019t allow shooting.",
                              "PUMP Fitness", "Enco Studio"])
    restrictions = s.placeholders[2].text_frame
    restrictions.add_paragraph()
    for text in ("List of locations not available under free trials.",
                 "FlowRider (One Utama)", "TreeTop Adventure (One Utama)"):
        para = restrictions.add_paragraph()
        para.add_run().text = text
    for i, para in enumerate(restrictions.paragraphs):
        para.level = 0 if i in (0, 4) else 1

    # 10 - caption
    s = new(8)
    _fill(s.placeholders[0], ["The Caption"])
    _fill(s.placeholders[1], [
        [("Your caption, your style.", N, N)],
        [("Encourage followers to join you through free trial using your own unique ", N, N),
         ("promocode", B, N), (".", N, N)],
        [("Use ", N, N), ("collaboration tag", B, N), (" for Instagram with 1Fit only.", N, N)],
        [("You may ", N, N), ("normal tag", B, N),
         (" the gym/studio as well, if relevant.", N, N)],
    ])

    # 11 - promo code
    s = new(9)
    _fill(s.placeholders[0], ["The Promo Code"])
    _fill(s.placeholders[1], [
        [("Create the 7-day free trial promo code on your own", N, N)],
        [("In app, go to membership", N, N)],
        [("Select \u2018", N, N), ("Gift a Free Trial\u2019", B, N)],
        [("Personalise & Generate", N, N)],
        [("Use it in your video and/or caption", N, N)],
    ])

    # 12 - reminder
    s = new(10)
    _fill(s.placeholders[0], ["A very very friendly reminder"])
    _fill(s.placeholders[1], ["Ideas shown are just for reference only, we totally value "
                              "your content creativity & we just have to make sure all the "
                              "1Fit points are in and wrapped with your own original flair"])
    _fill(s.placeholders[2], ["-1Fit Marketing Team"])

    # 13 - how do we start
    s = new(11)
    _fill(s.placeholders[0], ["How do", "we start"])
    _fill(s.placeholders[1], [
        [("Download 1Fit app & sign up", N, N)],
        [("Send us your registered mobile number & we'll activate your EXCLUSIVE "
          "AMBASSADOR membership for you.", N, N)],
        [("Check out our app & locations to spark your content ideas ;P", N, N)],
        [("Submit your simple script or content idea for approval.", N, N)],
        [("After your membership is activated, you're all set to visit any gyms and "
          "attend any classes, and create content while you're at it!", N, N)],
        [("In app, go to the \u201cMembership\u201d tab, then select \u201c", N, N),
         ("Gift a Free Trial", B, N),
         ("\u201d to create your promo code.", N, N)],
        [("Once your followers activate your promo code, they'll get 7 days of "
          "unlimited workouts through 1Fit! Enjoy!", N, N)],
        [("Script/Idea & Draft (by you!) > Approve (by us!) > Post = Everybody "
          "loves 1Fit!!!", N, N)],
    ])

    # 14 - closing
    s = new(12)
    _fill(s.placeholders[0], ["Any questions?"])
    _fill(s.placeholders[1], ["Just let us know ;P"])


# --------------------------------------------------------------------------- #
# .potx export
# --------------------------------------------------------------------------- #

POTX_CT = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml"
PPTX_CT = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"


def write_potx(source: Path, target: Path) -> None:
    """Re-zip a .pptx as a .potx by swapping the presentation content type."""
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(
        target, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "[Content_Types].xml":
                data = data.replace(PPTX_CT.encode(), POTX_CT.encode())
            zout.writestr(item, data)


# --------------------------------------------------------------------------- #

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--heading-font", default=HEADING_FONT)
    parser.add_argument("--body-font", default=BODY_FONT)
    parser.add_argument("--name", default="1Fit-KOL-Template")
    args = parser.parse_args()

    DIST.mkdir(exist_ok=True)
    base = DIST / "_base.pptx"
    build_base(base, args.heading_font, args.body_font)

    prs = Presentation(str(base))
    add_sample_slides(prs)
    deck = DIST / f"{args.name}.pptx"
    prs.save(str(deck))

    # The .potx opens as a brand-new deck, so it ships with just a cover slide.
    starter = Presentation(str(base))
    cover = starter.slides.add_slide(starter.slide_masters[0].slide_layouts[0])
    _fill(cover.placeholders[0], ["1Fit App"])
    _fill(cover.placeholders[1], ["KOL Collab"])
    _fill(cover.placeholders[2], ["INFLUENCER", "CONTENT CREATION", "GUIDE-ISHHH"])
    seed = DIST / "_starter.pptx"
    starter.save(str(seed))
    write_potx(seed, DIST / f"{args.name}.potx")

    base.unlink()
    seed.unlink()
    print(f"wrote {deck}")
    print(f"wrote {DIST / f'{args.name}.potx'}")


if __name__ == "__main__":
    main()
