"""Outlined wordmark helpers shared by the logo builder and lettering studies."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

ROOT=Path(__file__).resolve().parents[1]
OPTIONS={
    'a-soft':{'family':'Nunito','weight':580,'shear':0,'height':88,'name':'柔和圆体','description':'圆润收笔，轻一些，也更亲和'},
    'b-flow':{'family':'Quicksand','weight':590,'shear':.065,'height':88,'name':'微倾流线','description':'微微向前，呼应丝带的舒展动势'},
    'c-modern':{'family':'Outfit','weight':480,'shear':0,'height':88,'name':'轻盈现代','description':'简洁清爽，保持成熟的产品气质'}
}

def outlines(option, text='kodo', tracking_em=None):
    item=OPTIONS[option]
    font=instantiateVariableFont(TTFont(ROOT/f"brand/fonts/{item['family']}/{item['family']}-Variable.ttf"),{'wght':item['weight']},inplace=False)
    glyphs=font.getGlyphSet();cmap=font.getBestCmap();pen=SVGPathPen(glyphs);bounds=BoundsPen(glyphs);x=0;upm=font['head'].unitsPerEm
    tracking = tracking_em if tracking_em is not None else ([-.030,-.015,-.020] if text=='kodo' else [-.015]*(len(text)-1))
    if len(tracking) != len(text)-1:
        raise ValueError('Provide one spacing adjustment per letter pair.')
    for i,char in enumerate(text):
        name=cmap[ord(char)];matrix=(1,0,item['shear'],1,x,0)
        glyphs[name].draw(TransformPen(pen,matrix));glyphs[name].draw(TransformPen(bounds,matrix))
        x+=font['hmtx'][name][0]
        if i<len(tracking):x+=upm*tracking[i]
    x0,y0,x1,y1=bounds.bounds
    scale=item['height']/(y1-y0)
    return pen.getCommands(),scale,round(x1*scale,2),dict(item,option=option,text=text,tracking_em=tracking,bounds=[x0,y0,x1,y1])
