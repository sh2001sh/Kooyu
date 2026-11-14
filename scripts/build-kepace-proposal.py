"""Meaning-led naming proposal; production assets remain unchanged."""
from pathlib import Path
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
import hashlib
import io
import json
import re
import urllib.request
import urllib.error
import cairosvg
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'brand/naming-studies/kepace'
INK,PAPER='#28232A','#FAF8F4'

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    original=(ROOT/'brand/assets/svg/kodo-mark.svg').read_bytes()
    mark=original.decode('utf-8')
    defs=re.search(r'<defs>.*?</defs>',mark,re.S).group()
    art=mark[mark.index('</defs>')+7:mark.rindex('</svg>')].strip()
    font=instantiateVariableFont(TTFont(ROOT/'brand/fonts/Quicksand/Quicksand-Variable.ttf'),{'wght':590},inplace=False)
    glyphs=font.getGlyphSet(); cmap=font.getBestCmap()
    pen=SVGPathPen(glyphs); bounds=BoundsPen(glyphs)
    tracking=[-.018,-.010,-.012,-.010,-.015]
    x=0;upm=font['head'].unitsPerEm
    for i,char in enumerate('kepace'):
        glyph=cmap[ord(char)];matrix=(1,0,.065,1,x,0)
        glyphs[glyph].draw(TransformPen(pen,matrix))
        glyphs[glyph].draw(TransformPen(bounds,matrix))
        x+=font['hmtx'][glyph][0]
        if i<len(tracking):x+=tracking[i]*upm
    x0,y0,x1,y1=bounds.bounds
    scale=88/(y1-y0);width=(x1-x0)*scale;word=pen.getCommands()
    total=round(181+width+16,2)
    sources={}
    for suffix,color in [('',INK),('-dark',PAPER)]:
        source=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} 132" width="{total}" height="132" role="img" aria-label="Kepace">{defs}<g transform="translate(-18 -24) scale(.1875)">{art}</g><path d="{word}" fill="{color}" transform="translate({181-x0*scale} {20+y1*scale}) scale({scale} -{scale})"/></svg>'
        sources[suffix]=source
        (OUT/f'kepace-logo{suffix}.svg').write_text(source,encoding='utf-8')
        cairosvg.svg2png(bytestring=source.encode(),write_to=str(OUT/f'kepace-logo{suffix}.png'),output_width=2200)
    source=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width+8} 132" role="img" aria-label="Kepace"><path d="{word}" fill="{INK}" transform="translate({4-x0*scale} {20+y1*scale}) scale({scale} -{scale})"/></svg>'
    (OUT/'kepace-wordmark.svg').write_text(source,encoding='utf-8')
    (OUT/'kepace-mark.svg').write_bytes(original)
    canvas=Image.new('RGB',(1800,1320),PAPER);draw=ImageDraw.Draw(canvas)
    font=lambda n:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',n)
    draw.text((80,49),'Kepace · 有来历，也顺口',font=font(38),fill=INK)
    draw.text((80,110),'Keep + Pace  /  kee–pace  /  两个音节',font=font(25),fill='#726B72')
    draw.line((80,177,1720,177),fill='#E5DEDA',width=2)
    for suffix,target,x,y in [('',1260,270,223),('-dark',1000,400,875)]:
        if suffix:draw.rounded_rectangle((80,827,1720,1140),radius=24,fill=INK)
        image=Image.open(io.BytesIO(cairosvg.svg2png(bytestring=sources[suffix].encode(),output_width=target))).convert('RGBA')
        canvas.paste(image,(x,y),image)
    draw.text((80,590),'让工具，跟上你的节奏。',font=font(36),fill=INK)
    draw.text((80,657),'Keep · 保持与延续     Pace · 步调与节奏',font=font(25),fill='#726B72')
    draw.text((80,708),'命名主张：让不同工具里的工作保持同一步调。',font=font(24),fill='#726B72')
    draw.text((80,1190),'沿用莫比乌斯丝带与日落珊瑚配色 · 新字标均为矢量路径',font=font(23),fill='#726B72')
    draw.text((80,1241),'命名提案 / 2026-11-13',font=font(20),fill='#726B72')
    canvas.save(OUT/'preview.png')
    url='https://rdap.verisign.com/com/v1/domain/kepace.com'
    domain={'domain':'kepace.com','checked_at_utc':datetime.now(timezone.utc).isoformat(),'source':url}
    try:
        with urllib.request.urlopen(url,timeout=20) as response:domain.update(http_status=response.status,outcome='registration_record_found')
    except urllib.error.HTTPError as error:domain.update(http_status=error.code,outcome='no_registration_record_returned' if error.code==404 else 'unverified')
    except Exception as error:domain.update(outcome='unverified',error=str(error))
    report={'proposal':'Kepace','status':'recommended_meaning_led_proposal','construction':'A deliberate brand contraction of Keep + Pace, not an existing English word.','suggested_pronunciation':'KEE-pace /kiːpeɪs/','brand_interpretation':'让不同工具里的工作保持同一步调，让工具跟上你的节奏。','dictionary_source':'https://dictionary.cambridge.org/us/dictionary/english/keep-pace','dictionary_note':'Keep pace refers to moving or progressing at the same rate as someone or something else. Brand wording is an interpretation.','symbol_sha256':hashlib.sha256(original).hexdigest(),'domain':domain,'web_screen':{'date':'2026-11-13','queries':['"Kepace"','"Kepace" software','"Kepace" AI','"kepace.com"'],'scope':'Limited exact-name search; not an exhaustive availability or trademark check.'},'limits':['No domain purchase or reservation.','404 does not guarantee registrar availability or price.','Trademark and phonetic-similarity checks remain incomplete.']}
    (OUT/'screening.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for file in OUT.glob('*.svg'):
        tags={node.tag.rsplit('}',1)[-1] for node in ET.parse(file).iter()}
        assert not tags.intersection({'image','text'}),file
    assert (OUT/'kepace-mark.svg').read_bytes()==original
    for file in OUT.glob('kepace-logo*.png'):
        with Image.open(file) as image:
            image.load();assert image.mode=='RGBA' and image.getextrema()[3][0]==0
    print(json.dumps({'output':str(OUT),'domain':domain,'svg_checked':4,'mark_unchanged':True},ensure_ascii=False))

if __name__=='__main__':main()
