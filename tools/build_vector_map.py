from PIL import Image
import numpy as np
from scipy import ndimage
import matplotlib.pyplot as plt

source='/workspace/scratch/9936ef5c92dc/upload/01-mapa-do-brasil-estados-branco-comlegenda.jpg'
target='/workspace/scratch/9936ef5c92dc/boreal-workstation/dist/assets/brazil-states.svg'
seeds={'AC':(130,615),'AL':(1550,670),'AP':(910,185),'AM':(400,400),'BA':(1275,740),'CE':(1385,450),'DF':(1055,865),'ES':(1400,1020),'GO':(975,900),'MA':(1180,440),'MT':(740,755),'MS':(800,1055),'MG':(1160,1010),'PA':(850,445),'PB':(1535,540),'PR':(900,1220),'PE':(1455,590),'PI':(1260,550),'RJ':(1245,1145),'RN':(1515,490),'RS':(830,1430),'RO':(450,675),'RR':(515,165),'SC':(950,1365),'SP':(1010,1120),'SE':(1470,690),'TO':(1035,650)}
names={'AC':'Acre','AL':'Alagoas','AP':'Amapá','AM':'Amazonas','BA':'Bahia','CE':'Ceará','DF':'Distrito Federal','ES':'Espírito Santo','GO':'Goiás','MA':'Maranhão','MT':'Mato Grosso','MS':'Mato Grosso do Sul','MG':'Minas Gerais','PA':'Pará','PB':'Paraíba','PR':'Paraná','PE':'Pernambuco','PI':'Piauí','RJ':'Rio de Janeiro','RN':'Rio Grande do Norte','RS':'Rio Grande do Sul','RO':'Rondônia','RR':'Roraima','SC':'Santa Catarina','SP':'São Paulo','SE':'Sergipe','TO':'Tocantins'}
region_labels={'AC':27,'AL':32,'AP':3,'AM':7,'BA':31,'CE':12,'DF':43,'ES':49,'GO':40,'MA':10,'MT':23,'MS':48,'MG':42,'PA':4,'PB':20,'PR':53,'PE':26,'PI':11,'RJ':51,'RN':18,'RS':58,'RO':28,'RR':2,'SC':57,'SP':50,'SE':34,'TO':17}

def rdp(points,eps=2.3):
    if len(points)<3:return points
    a,b=points[0],points[-1];v=b-a
    if np.allclose(v,0):d=np.linalg.norm(points-a,axis=1)
    else:d=np.abs(np.cross(v,points-a)/np.linalg.norm(v))
    i=int(np.argmax(d))
    if d[i]>eps:return np.vstack((rdp(points[:i+1],eps)[:-1],rdp(points[i:],eps)))
    return np.vstack((a,b))

img=np.asarray(Image.open(source).convert('L'))
white=img>205
labels,_=ndimage.label(white,structure=np.array([[0,1,0],[1,1,1],[0,1,0]]))
paths=[]
for uf,(x,y) in seeds.items():
    x,y=int(x*1.25),int(y*1.25)
    lab=region_labels[uf]
    mask=labels==lab
    fig,ax=plt.subplots()
    cs=ax.contour(mask.astype(float),levels=[.5])
    segs=cs.allsegs[0]
    plt.close(fig)
    seg=max(segs,key=lambda p:abs(np.cross(p,np.roll(p,1,axis=0)).sum()))
    seg=rdp(seg[:,[0,1]])
    d='M '+' L '.join(f'{p[0]:.1f},{p[1]:.1f}' for p in seg)+' Z'
    paths.append(f'<path id="state-{uf}" data-uf="{uf}" aria-label="{names[uf]}" d="{d}"/>')
texts=[]
for uf,(x,y) in seeds.items():
    x,y=int(x*1.25),int(y*1.25)
    texts.append(f'<text x="{x}" y="{y}" data-label="{uf}">{uf}</text>')
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" role="img" aria-labelledby="map-title"><title id="map-title">Mapa interativo do Brasil por estado</title><g class="states">{''.join(paths)}</g><g class="state-labels">{''.join(texts)}</g></svg>'''
with open(target,'w',encoding='utf-8') as f:f.write(svg)
print(target, len(svg), 'bytes')
