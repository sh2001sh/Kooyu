"""Create a naming proposal; keep the current production identity untouched."""
from pathlib import Path
from datetime import datetime, timezone
import concurrent.futures
import hashlib
import io
import json
import re
import urllib.request
import urllib.error
from xml.etree import ElementTree as ET

import cairosvg
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'brand/naming-studies/kelivu'
NAME = 'Kelivu'
INK, PAPER = '#28232A', '#FAF8F4'

def lettering():
    font = instantiateVariableFont(TTFont(ROOT/'brand/fonts/Quicksand/Quicksand-Variable.ttf'), {'wght': 590}, inplace=False)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
    tracking = [-.018, -.012, -.008, -.005, -.014]
    x, upm = 0, font['head'].unitsPerEm
    for index, char in enumerate(NAME.lower()):
        glyph = cmap[ord(char)]
        matrix = (1, 0, .065, 1, x, 0)
        glyphs[glyph].draw(TransformPen(pen, matrix))
        glyphs[glyph].draw(TransformPen(bounds, matrix))
        x += font['hmtx'][glyph][0]
        if index < len(tracking):
            x += upm * tracking[index]
    x0, y0, x1, y1 = bounds.bounds
    scale = 88/(y1-y0)
    return pen.getCommands(), scale, (x1-x0)*scale, x0, y1, tracking

def domain_query(domain):
    url = 'https://rdap.verisign.com/com/v1/domain/' + domain
    result = {'domain': domain, 'checked_at_utc': datetime.now(timezone.utc).isoformat(), 'source': url}
    try:
        request = urllib.request.Request(url, headers={'Accept': 'application/rdap+json', 'User-Agent': 'BrandNamingResearch/1.0'})
        with urllib.request.urlopen(request, timeout=20) as response:
            result.update(http_status=response.status, outcome='registration_record_found')
    except urllib.error.HTTPError as error:
        result.update(http_status=error.code, outcome='no_registration_record_returned' if error.code == 404 else 'unverified')
    except Exception as error:
        result.update(outcome='unverified', error=str(error))
    return result

def render(source, width):
    data = cairosvg.svg2png(bytestring=source.encode('utf-8'), output_width=width)
    return Image.open(io.BytesIO(data)).convert('RGBA')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    original = (ROOT/'brand/assets/svg/kodo-mark.svg').read_bytes()
    mark = original.decode('utf-8')
    defs = re.search(r'<defs>.*?</defs>', mark, re.S).group()
    art = mark[mark.index('</defs>')+7:mark.rindex('</svg>')].strip()
    word, scale, width, x0, y1, tracking = lettering()
    total = round(181 + width + 16, 2)
    sources = {}
    for suffix, color in [('', INK), ('-dark', PAPER)]:
        transform = f'translate({181-x0*scale} {20+y1*scale}) scale({scale} -{scale})'
        source = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} 132" width="{total}" height="132" role="img" aria-label="Kelivu">{defs}<g transform="translate(-18 -24) scale(.1875)">{art}</g><path d="{word}" fill="{color}" transform="{transform}"/></svg>'
        sources[suffix] = source
        (OUT/f'kelivu-logo{suffix}.svg').write_text(source, encoding='utf-8')
        render(source, 2200).save(OUT/f'kelivu-logo{suffix}.png')
    source = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width+8} 132" role="img" aria-label="Kelivu"><path d="{word}" fill="{INK}" transform="translate({4-x0*scale} {20+y1*scale}) scale({scale} -{scale})"/></svg>'
    (OUT/'kelivu-wordmark.svg').write_text(source, encoding='utf-8')
    (OUT/'kelivu-mark.svg').write_bytes(original)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        domains = list(pool.map(domain_query, ['kelivu.com', 'kovinu.com', 'keluvu.com']))
    report = {
        'proposal': NAME, 'status': 'recommended_name_proposal',
        'pronunciation': 'keh-LEE-voo', 'ipa': '/kɛˈliːvuː/',
        'lettering': {'font': 'Quicksand', 'weight': 590, 'shear': .065, 'tracking_em': tracking, 'outlined': True},
        'symbol_sha256': hashlib.sha256(original).hexdigest(),
        'domains': domains,
        'web_screen': {
            'date': '2026-11-13',
            'queries': ['"Kelivu"', '"Kelivu" software OR AI OR app OR company', '"Kelivu" "Kelivo"'],
            'finding': 'No clear exact-name AI/software brand identified in the limited returned results. This is not exhaustive.',
            'known_nonbrand_hits': ['Constructed-language conjugation tables; OCR dictionary entries'],
        },
        'limits': ['No purchase or reservation performed.', '404 is a registry observation, not a registrar checkout or price guarantee.', 'Trademark and similar-sounding-name clearance remain incomplete.'],
    }
    (OUT/'screening.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    canvas = Image.new('RGB', (1800, 1240), PAPER)
    draw = ImageDraw.Draw(canvas)
    face = 'C:/Windows/Fonts/msyh.ttc'
    font = lambda size: ImageFont.truetype(face, size)
    draw.text((80, 52), 'Kelivu · 新名字提案', font=font(38), fill=INK)
    draw.text((80, 111), 'keh–LEE–voo  /  六个字母 · 三个音节 · 轻盈而有动势', font=font(24), fill='#726B72')
    draw.line((80, 180, 1720, 180), fill='#E5DEDA', width=2)
    image = render(sources[''], 1260)
    canvas.paste(image, (260, 230), image)
    draw.text((80, 595), '让工作，接着向前。', font=font(33), fill=INK)
    draw.text((80, 648), '本地 AI 会话工作台', font=font(24), fill='#726B72')
    draw.rounded_rectangle((80, 740, 1720, 1055), radius=24, fill=INK)
    image = render(sources['-dark'], 1040)
    canvas.paste(image, (380, 785), image)
    draw.text((80, 1110), '保留现有莫比乌斯丝带与日落珊瑚配色 · 小写字标为可编辑矢量路径', font=font(23), fill='#726B72')
    draw.text((80, 1155), '命名与组合效果提案 / 2026-11-13', font=font(20), fill='#726B72')
    canvas.save(OUT/'preview.png')
    for file in OUT.glob('*.svg'):
        tags = {node.tag.rsplit('}', 1)[-1] for node in ET.parse(file).iter()}
        assert not tags.intersection({'image', 'text'}), file
    assert (OUT/'kelivu-mark.svg').read_bytes() == original
    for file in OUT.glob('kelivu-logo*.png'):
        with Image.open(file) as image:
            image.load()
            assert image.mode == 'RGBA' and image.getextrema()[3][0] == 0
    print(json.dumps({'output': str(OUT), 'domains': domains, 'svg_checked': 4, 'mark_unchanged': True}, ensure_ascii=False))

if __name__ == '__main__':
    main()
