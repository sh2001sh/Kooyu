"""Build production SVG/PNG/icon assets from the approved coral ribbon silhouette.

The mark uses fitted periodic cubic Bezier paths and editable SVG gradients.
No raster image is embedded in an SVG. Application source is never modified.
"""
from pathlib import Path
import hashlib
import io
import json
import shutil
from xml.etree import ElementTree
import cv2
import numpy as np
from scipy.interpolate import splprep, splev
from skimage.measure import find_contours
from PIL import Image
import cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from brand_wordmark import OPTIONS,outlines

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'brand/mobius-k/colors/coral.png'
OUT = ROOT / 'brand/assets'
CORAL, PEACH, BERRY, INK, PAPER = '#F17561', '#FFD0B3', '#A03259', '#28232A', '#FAF8F4'
IDENTITY = json.loads((ROOT/'brand/identity.json').read_text(encoding='utf-8'))
WORDMARK_OPTION = json.loads((ROOT/'brand/wordmark-selection.json').read_text(encoding='utf-8'))['option']
assert IDENTITY['name'] == 'Kooyu' and IDENTITY['slug'] == 'kooyu'

def cubic_path(contour):
    pts=contour[:,0,:].astype(float)
    tck,_=splprep([pts[:,0],pts[:,1]],s=len(pts)*.20,per=True,k=3)
    knots=np.unique(tck[0]);knots=knots[(knots>=0)&(knots<=1)]
    first=np.array(splev(0,tck));parts=[f'M{first[0]:.2f} {first[1]:.2f}']
    for a,b in zip(knots[:-1],knots[1:]):
        p0=np.array(splev(a,tck));p3=np.array(splev(b,tck))
        p1=p0+np.array(splev(a,tck,der=1))*(b-a)/3
        p2=p3-np.array(splev(b,tck,der=1))*(b-a)/3
        parts.append(f'C{p1[0]:.2f} {p1[1]:.2f} {p2[0]:.2f} {p2[1]:.2f} {p3[0]:.2f} {p3[1]:.2f}')
    return ' '.join(parts)+' Z',len(knots)-1

def document(body,viewbox='96 128 848 704',width=848,height=704,label='Kooyu',defs=''):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{viewbox}" role="img" aria-label="{label}">
<title>{label}</title>
<desc>Original Kooyu sunset-coral ribbon identity. Cubic Bezier vector paths; no embedded bitmap.</desc>
{defs}{body}
</svg>\n'''

def gradient_art(path):
    defs=f'''<defs>
<clipPath id="kooyu-silhouette"><path d="{path}" fill-rule="evenodd" clip-rule="evenodd"/></clipPath>
<linearGradient id="kooyu-loop" gradientUnits="userSpaceOnUse" x1="130" y1="640" x2="445" y2="390"><stop stop-color="{PEACH}"/><stop offset=".48" stop-color="{CORAL}"/><stop offset="1" stop-color="#BD465F"/></linearGradient>
<linearGradient id="kooyu-upper" gradientUnits="userSpaceOnUse" x1="360" y1="560" x2="910" y2="180"><stop stop-color="#C84C5F"/><stop offset=".44" stop-color="{CORAL}"/><stop offset="1" stop-color="{PEACH}"/></linearGradient>
<linearGradient id="kooyu-lower" gradientUnits="userSpaceOnUse" x1="467" y1="524" x2="840" y2="780"><stop stop-color="{BERRY}"/><stop offset=".39" stop-color="{CORAL}"/><stop offset="1" stop-color="{PEACH}"/></linearGradient>
<linearGradient id="kooyu-front" gradientUnits="userSpaceOnUse" x1="151" y1="664" x2="490" y2="505"><stop stop-color="{PEACH}"/><stop offset=".46" stop-color="{CORAL}"/><stop offset="1" stop-color="{PEACH}"/></linearGradient>
</defs>'''
    art=f'''<g clip-path="url(#kooyu-silhouette)">
<path d="{path}" fill="url(#kooyu-loop)" fill-rule="evenodd"/>
<path d="M450 510 C570 550 745 550 890 650 L1030 1030 H435 V650 Z" fill="url(#kooyu-lower)"/>
<path d="M205 618 C300 600 368 545 435 478 C525 370 600 190 700 140 L1030 120 V480 L720 470 L520 490 C400 550 290 608 205 618 Z" fill="url(#kooyu-upper)"/>
<path d="M0 615 C185 635 265 625 365 570 C420 540 470 510 520 485 C500 515 477 548 454 572 C420 630 330 710 200 760 L0 800 Z" fill="url(#kooyu-front)"/>
</g>'''
    return defs,art

def write(name,body,viewbox='96 128 848 704',width=848,height=704,label='Kooyu',defs=''):
    (OUT/'svg'/name).write_text(document(body,viewbox,width,height,label,defs),encoding='utf-8')

def render(source,target,width=None,height=None):
    cairosvg.svg2png(url=str(source),write_to=str(target),output_width=width,output_height=height)

def wordmark():
    word,scale,width,metadata=outlines(WORDMARK_OPTION, 'kooyu', [-.025, -.012, -.008, -.010])
    x0,y0,x1,y1=metadata['bounds']
    normalized=SVGPathPen(None)
    parse_path(word,TransformPen(normalized,(1,0,0,1,-x0,-y0)))
    return normalized.getCommands(),scale,round((x1-x0)*scale,2)

def main():
    for folder in ['svg','png','icons','fonts','components']:(OUT/folder).mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/'brand/identity.json',OUT/'identity.json')
    original=np.array(Image.open(SOURCE).convert('RGB'))/255
    mask=np.uint8((original.max(2)-original.min(2)>.09)*255)
    selected=[c[:,::-1].reshape(-1,1,2)+.5 for c in find_contours(mask/255,.5) if len(c)>100]
    fitted=[cubic_path(c) for c in selected]
    path=' '.join(p for p,n in fitted)
    defs,art=gradient_art(path)
    react_component(path,defs,art)
    write('kooyu-mark.svg',art,label='Kooyu · 日落珊瑚标志',defs=defs)
    for suffix,color in [('coral',CORAL),('ink',INK),('white','#FFFFFF')]:
        write(f'kooyu-mark-{suffix}.svg',f'<path d="{path}" fill="{color}" fill-rule="evenodd"/>',label=f'Kooyu · {suffix}')
    write('kooyu-mark-currentcolor.svg',f'<path d="{path}" fill="currentColor" fill-rule="evenodd"/>',label='Kooyu · inherits text color')
    word,scale,word_width=wordmark();total=round(181+word_width+16,2)
    wordmark_component(word,scale,word_width)
    for suffix,textcolor in [('',INK),('-dark',PAPER)]:
        body=f'<g transform="translate(-18 -24) scale(.1875)">{art}</g><path d="{word}" fill="{textcolor}" transform="translate(181 108) scale({scale} -{scale})"/>'
        write(f'kooyu-logo{suffix}.svg',body,f'0 0 {total} 132',total,132,'Kooyu · horizontal lockup',defs)
    for suffix,color in [('ink',INK),('white','#FFFFFF'),('coral',CORAL),('currentcolor','currentColor')]:
        body=f'<g transform="translate(-18 -24) scale(.1875)"><path d="{path}" fill="{color}" fill-rule="evenodd"/></g><path d="{word}" fill="{color}" transform="translate(181 108) scale({scale} -{scale})"/>'
        write(f'kooyu-logo-{suffix}.svg',body,f'0 0 {total} 132',total,132,'Kooyu · monochrome horizontal lockup')
    for suffix,color in [('',INK),('-white','#FFFFFF')]:
        write(f'kooyu-wordmark{suffix}.svg',f'<path d="{word}" fill="{color}" transform="translate(4 108) scale({scale} -{scale})"/>',f'0 0 {word_width+8} 132',word_width+8,132,'Kooyu · outlined wordmark')
    # White silhouette remains clear at tray/favicon sizes.
    for suffix,background,foreground in [('',CORAL,'#FFFFFF'),('-dark',INK,PEACH)]:
        icon=f'<rect width="512" height="512" rx="112" fill="{background}"/><g transform="translate(3.46 21.52) scale(.488)"><path d="{path}" fill="{foreground}" fill-rule="evenodd"/></g>'
        (OUT/f'icons/kooyu-app{suffix}.svg').write_text(document(icon,'0 0 512 512',512,512,'Kooyu · application icon'),encoding='utf-8')
    for name in ['kooyu-mark','kooyu-mark-coral','kooyu-mark-ink','kooyu-mark-white']:
        for width in [1024,2048]:render(OUT/f'svg/{name}.svg',OUT/f'png/{name}-{width}.png',width)
    for name in ['kooyu-logo','kooyu-logo-dark','kooyu-logo-white','kooyu-wordmark']:
        render(OUT/f'svg/{name}.svg',OUT/f'png/{name}-2000.png',2000)
    for size in [16,24,32,48,64,128,180,192,256,512,1024]:
        render(OUT/'icons/kooyu-app.svg',OUT/f'icons/kooyu-app-{size}.png',size,size)
    render(OUT/'icons/kooyu-app-dark.svg',OUT/'icons/kooyu-app-dark-512.png',512,512)
    icon=Image.open(OUT/'icons/kooyu-app-1024.png').convert('RGBA')
    icon.save(OUT/'icons/kooyu-app.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    icon.save(OUT/'icons/kooyu-app.icns')
    # Maskable version has an opaque, full-bleed field and safe inset symbol.
    maskable=f'<rect width="512" height="512" fill="{CORAL}"/><g transform="translate(64.5 78.2) scale(.37)"><path d="{path}" fill="#FFFFFF" fill-rule="evenodd"/></g>'
    for size in [192,512]:
        data=cairosvg.svg2png(bytestring=document(maskable,'0 0 512 512',512,512).encode(),output_width=size,output_height=size)
        (OUT/f'icons/kooyu-maskable-{size}.png').write_bytes(data)
    manifest={'name':'Kooyu','short_name':'Kooyu','start_url':'/','display':'standalone','background_color':PAPER,'theme_color':CORAL,'icons':[{'src':'kooyu-app-192.png','sizes':'192x192','type':'image/png','purpose':'any'},{'src':'kooyu-app-512.png','sizes':'512x512','type':'image/png','purpose':'any'},{'src':'kooyu-maskable-512.png','sizes':'512x512','type':'image/png','purpose':'maskable'}]}
    (OUT/'icons/site.webmanifest').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for name in ['manrope-latin.woff2','OFL.txt']:shutil.copyfile(ROOT/'brand/fonts'/name,OUT/'fonts'/name)
    active=OPTIONS[WORDMARK_OPTION];family=active['family'];fontfile=ROOT/f'brand/fonts/{family}/{family}-Variable.ttf'
    webfont=TTFont(fontfile);webfont.flavor='woff2';webfont.save(OUT/f'fonts/{family.lower()}-latin.woff2')
    shutil.copyfile(ROOT/f'brand/fonts/{family}/OFL.txt',OUT/f'fonts/OFL-{family}.txt')
    tokens={'brand':'Kooyu','direction':'灵动回环 · 日落珊瑚','color':{'coral':CORAL,'peach':PEACH,'berry':BERRY,'paper':PAPER,'ink':INK,'action':'#BE4C42'},'font':{'wordmark':f"{family} {active['weight']}, optical spacing and gentle lean, outlined",'wordmark_revision':WORDMARK_OPTION,'wordmark_shear':active['shear'],'ui':'system-ui, Segoe UI, Microsoft YaHei, sans-serif'},'source':'../mobius-k/colors/coral.png','svg_contains_raster':False}
    (OUT/'tokens.json').write_text(json.dumps(tokens,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (OUT/'tokens.css').write_text(':root{--kooyu-coral:#f17561;--kooyu-peach:#ffd0b3;--kooyu-berry:#a03259;--kooyu-paper:#faf8f4;--kooyu-ink:#28232a;--kooyu-action:#be4c42;}\n',encoding='utf-8')
    legacy_aliases()
    verify(mask,sum(n for p,n in fitted),path)
    preview(path,defs,art,word,scale,total)
    for folder in ['svg','icons']:
        destination=ROOT/'brand'/('logos' if folder=='svg' else 'icons')
        destination.mkdir(exist_ok=True)
        for file in (OUT/folder).iterdir():
            if file.is_file():shutil.copyfile(file,destination/file.name)
    shutil.copyfile(OUT/'icons/kooyu-app.ico',ROOT/'brand/icons/favicon.ico')
    for name in ['tokens.json','tokens.css']:shutil.copyfile(OUT/name,ROOT/'brand'/('design-'+name))
    print('Built genuine Bezier SVG marks/lockups, transparent PNGs, ICO/ICNS/PWA icons, tokens and preview. Application source unchanged.')

def legacy_aliases():
    # Existing consumers may still request the former public file names.
    for folder in ['svg', 'png', 'icons']:
        for source in (OUT/folder).glob('kooyu-*'):
            shutil.copyfile(source, source.with_name(source.name.replace('kooyu-', 'kodo-', 1)))
    (OUT/'components/KodoMark.tsx').write_text(
        'export { KooyuMark as KodoMark } from "./KooyuMark";\n'
        'export type { KooyuMarkProps as KodoMarkProps } from "./KooyuMark";\n',
        encoding='utf-8',
    )
    css = (OUT/'tokens.css').read_text(encoding='utf-8')
    aliases = ':root{' + ''.join('--kodo-' + name + ':var(--kooyu-' + name + ');' for name in ['coral','peach','berry','paper','ink','action']) + '}\n'
    (OUT/'tokens.css').write_text(css + aliases, encoding='utf-8')

def verify(mask,segments,path):
    svgfiles=list(OUT.rglob('*.svg'))
    for file in svgfiles:
        tree=ElementTree.parse(file);source=file.read_text(encoding='utf-8')
        assert not any(e.tag.endswith('image') for e in tree.iter()),file
        assert 'data:image' not in source and 'base64' not in source,file
    mono=document(f'<path d="{path}" fill="white" fill-rule="evenodd"/>','0 0 1024 1024',1024,1024)
    rendered=np.array(Image.open(io.BytesIO(cairosvg.svg2png(bytestring=mono.encode()))).convert('RGBA'))[...,3]>127
    target=mask>127;iou=float(np.sum(rendered&target)/np.sum(rendered|target))
    assert iou>.99,iou
    for file in OUT.rglob('*.png'):
        with Image.open(file) as im:im.verify()
    stats={'svg_files':len(svgfiles),'cubic_segments':segments,'silhouette_iou':round(iou,6),'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'raster_embedded':False,'gradient_note':'Silhouette fitted to approved source; editable surface gradients are a production interpretation, not pixel-identical raster tracing.'}
    (OUT/'validation.json').write_text(json.dumps(stats,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(stats))

def wordmark_component(word,scale,width):
    source = """import type { SVGProps } from 'react';

/** Kooyu outlined wordmark. Generated from brand/assets/svg/kooyu-wordmark.svg. */
export function KooyuWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 __WIDTH__ 132" role="img" aria-label="Kooyu" {...props}>
      <path d="__PATH__" fill="currentColor" transform="translate(4 108) scale(__SCALE__ -__SCALE__)" />
    </svg>
  );
}
""".replace('__WIDTH__',str(width+8)).replace('__PATH__',word).replace('__SCALE__',str(scale))
    (OUT/'components/KooyuWordmark.tsx').write_text(source,encoding='utf-8')

def react_component(path,defs,art):
    jsx=defs+art
    for old,new in [('clip-path','clipPath'),('fill-rule','fillRule'),('clip-rule','clipRule'),('stop-color','stopColor')]:jsx=jsx.replace(old,new)
    for key in ['silhouette','loop','upper','lower','front']:
        jsx=jsx.replace(f'id="kooyu-{key}"',f'id={{uid + "-{key}"}}')
        jsx=jsx.replace(f'"url(#kooyu-{key})"','{"url(#" + uid + "-'+key+')"}')
    source='''import { useId, type SVGProps } from 'react';

export type KooyuMarkProps = SVGProps<SVGSVGElement> & { monochrome?: boolean };

/** Approved coral ribbon silhouette; unique gradient IDs allow repeated inline use. */
export function KooyuMark({ monochrome = false, ...props }: KooyuMarkProps) {
  const uid = 'kooyu-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="96 128 848 704" width="40" height="34" role="img" aria-label="Kooyu" {...props}>
      {monochrome ? <path d="'''+path+'''" fill="currentColor" fillRule="evenodd" /> : <>
'''+jsx+'''
      </>}
    </svg>
  );
}
'''
    (OUT/'components/KooyuMark.tsx').write_text(source,encoding='utf-8')

def preview(path,defs,art,word,scale,total):
    # Vector proof board: light, dark, monochrome, small sizes, and lockup.
    body=f'<rect width="1600" height="1000" fill="{PAPER}"/><g transform="translate(20 -35) scale(.68)">{art}</g><g transform="translate(780 70)"><rect width="750" height="500" rx="24" fill="{INK}"/><g transform="translate(90 -15) scale(.55)">{art}</g></g>'
    body+=f'<g transform="translate(80 690)"><g transform="translate(-18 -24) scale(.1875)">{art}</g><path d="{word}" fill="{INK}" transform="translate(181 108) scale({scale} -{scale})"/></g>'
    body+=f'<g transform="translate(790 650) scale(.24)"><path d="{path}" fill="{INK}" fill-rule="evenodd"/></g>'
    body+=f'<g transform="translate(1100 650) scale(.24)"><path d="{path}" fill="{CORAL}" fill-rule="evenodd"/></g>'
    for i,size in enumerate([16,24,32,48,64]):
        s=size/848;body+=f'<g transform="translate({100+i*110} 925) scale({s}) translate(-96 -128)"><path d="{path}" fill="{INK}" fill-rule="evenodd"/></g>'
    source=document(body,'0 0 1600 1000',1600,1000,'Kooyu · vector asset proof',defs)
    (OUT/'brand-assets-preview.svg').write_text(source,encoding='utf-8')
    cairosvg.svg2png(bytestring=source.encode(),write_to=str(OUT/'brand-assets-preview.png'))

if __name__=='__main__':main()
