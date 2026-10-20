from PIL import Image
import numpy as np
from scipy import ndimage
import matplotlib.pyplot as plt

source='/workspace/scratch/9936ef5c92dc/upload/02-estado-minas-gerais-microrregioes.png'
target='/workspace/scratch/9936ef5c92dc/boreal-workstation/dist/assets/minas-regions.svg'
img=np.asarray(Image.open(source).convert('L'))
labels,n=ndimage.label(img>245,structure=np.array([[0,1,0],[1,1,1],[0,1,0]]))
sizes=np.bincount(labels.ravel())

def rdp(points,eps=1.2):
    if len(points)<3:return points
    a,b=points[0],points[-1];v=b-a
    d=np.linalg.norm(points-a,axis=1) if np.allclose(v,0) else np.abs(v[0]*(a[1]-points[:,1])-(a[0]-points[:,0])*v[1])/np.linalg.norm(v)
    i=int(np.argmax(d))
    if d[i]>eps:return np.vstack((rdp(points[:i+1],eps)[:-1],rdp(points[i:],eps)))
    return np.vstack((a,b))

paths=[]; idx=0
for lab,size in enumerate(sizes):
    if lab==0 or size<700 or size>40000: continue
    ys,xs=np.where(labels==lab)
    if not len(xs) or xs.min()>1080 or ys.min()<35 or ys.max()>780: continue
    mask=labels==lab
    fig,ax=plt.subplots();cs=ax.contour(mask.astype(float),levels=[.5]);segs=cs.allsegs[0];plt.close(fig)
    if not segs:continue
    seg=max(segs,key=len);seg=rdp(seg[:,[0,1]])
    d='M '+' L '.join(f'{p[0]:.1f},{p[1]:.1f}' for p in seg)+' Z'
    cx=float(xs.mean());cy=float(ys.mean());idx+=1
    paths.append(f'<path data-region="{idx}" data-cx="{cx:.1f}" data-cy="{cy:.1f}" d="{d}"/>')
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 827" role="img" aria-labelledby="mg-title"><title id="mg-title">Mapa de regiões de Minas Gerais</title><g class="municipal-regions">{''.join(paths)}</g></svg>'''
with open(target,'w',encoding='utf-8') as f:f.write(svg)
print(target,idx,'regions',len(svg),'bytes')
