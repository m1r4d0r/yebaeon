from pathlib import Path
import xml.etree.ElementTree as ET, base64, re, urllib.parse, os, json, hashlib, unicodedata, collections

def norm_nfc(s): return unicodedata.normalize('NFC', s or '')

def rtf_to_text_b64(b64):
    if not b64: return ''
    try: raw=base64.b64decode(b64)
    except: return ''
    # PP6 Mac fixtures use CP949; browser exports use signed Unicode RTF.
    # Respect group-scoped code pages, skipped destinations and Unicode fallbacks.
    s=raw.decode('latin1'); state={'skip':False,'cp':1252,'uc':1}; stack=[]
    out=[]; pending=bytearray(); fallback=0; i=0
    destinations={'fonttbl','colortbl','expandedcolortbl','stylesheet','info',
                  'pict','object','header','footer','fldinst','listtable','listoverridetable'}
    def emit(text):
        if not state['skip']: out.append(text)
    def flush():
        if pending:
            encoding='utf-8' if state['cp']==65001 else 'cp'+str(state['cp'])
            try: emit(pending.decode(encoding,errors='replace'))
            except LookupError: emit(pending.decode('cp1252',errors='replace'))
            pending.clear()
    def byte(value):
        nonlocal fallback
        if fallback: fallback-=1
        else: pending.append(value)
    while i<len(s):
        c=s[i]; i+=1
        if c in '{}':
            flush()
            if c=='{': stack.append(state.copy())
            elif stack: state=stack.pop()
            continue
        if c in '\r\n': continue
        if c!='\\': byte(ord(c)); continue
        if i>=len(s): break
        c=s[i]
        if c=="'" and i+2<len(s):
            try: byte(int(s[i+1:i+3],16))
            except ValueError: pass
            i+=3; continue
        if c in '\\{}': byte(ord(c)); i+=1; continue
        flush()
        if c=='*': state['skip']=True; i+=1; continue
        if c in '\r\n':
            emit('\n'); i+=1
            if c=='\r' and i<len(s) and s[i]=='\n': i+=1
            continue
        if c in '~_':
            if fallback: fallback-=1
            else: emit('\u00a0' if c=='~' else '\u2011')
            i+=1; continue
        m=re.match(r'([a-zA-Z]+)(-?\d+)? ?',s[i:])
        if not m: i+=1; continue
        word=m[1]; value=int(m[2]) if m[2] else 1; i+=m.end()
        if word in destinations: state['skip']=True
        if state['skip']: continue
        if word=='ansicpg': state['cp']=value
        elif word=='uc': state['uc']=max(0,value)
        elif word=='u': emit(chr(value % 65536)); fallback=state['uc']
        elif word in ('par','line'): emit('\n')
        elif word=='tab': emit('\t')
        elif word in ('emdash','endash','bullet','lquote','rquote','ldblquote','rdblquote'):
            emit({'emdash':'—','endash':'–','bullet':'•','lquote':'‘','rquote':'’','ldblquote':'“','rdblquote':'”'}[word])
    flush()
    # Combine UTF-16 surrogate pairs emitted by RTF Unicode escapes.
    txt=''.join(out).encode('utf-16-le',errors='surrogatepass').decode('utf-16-le',errors='replace')
    return txt.replace('\r\n','\n').replace('\r','\n').strip()

def src_path(src):
    if not src: return ''
    if src.startswith('file://'):
        u=urllib.parse.urlparse(src); return urllib.parse.unquote(u.path)
    return urllib.parse.unquote(src)

def basename(src): return norm_nfc(os.path.basename(src_path(src)))

def sorted_attr_str(attrs, exclude=()):
    return '|'.join(f'{k}={attrs[k]}' for k in sorted(attrs) if k not in exclude)

def child_text(el, tag, ivar=None):
    for c in el:
        if c.tag==tag and (ivar is None or c.attrib.get('rvXMLIvarName')==ivar):
            return (c.text or '').strip()
    return ''

def hashstr(s): return hashlib.sha256(s.encode('utf-8')).hexdigest()

def parse_text_element(te):
    rtf=''
    for c in te.iter('NSString'):
        if c.attrib.get('rvXMLIvarName')=='RTFData': rtf=c.text or ''; break
    txt=rtf_to_text_b64(rtf)
    pos=child_text(te,'RVRect3D','position'); shadow=child_text(te,'shadow','shadow')
    attrs=sorted_attr_str(te.attrib, {'UUID','source'})
    stroke=''
    for d in te:
        if d.tag=='dictionary' and d.attrib.get('rvXMLIvarName')=='stroke': stroke=ET.tostring(d,encoding='unicode')
    style='||'.join([attrs,pos,shadow,stroke])
    return {'displayName':te.attrib.get('displayName',''),'text':txt,'normText':' '.join(txt.split()),'position':pos,'style':style}

def parse_media_element(me, parent_map):
    source=me.attrib.get('source',''); par=parent_map.get(me)
    bg=par is not None and par.tag=='RVMediaCue' and par.attrib.get('rvXMLIvarName')=='backgroundMediaCue'
    pos=child_text(me,'RVRect3D','position')
    attrs=sorted_attr_str(me.attrib, {'UUID','source','manufactureURL','manufactureName'})
    return {'kind':me.tag,'basename':basename(source),'source':source,'sourcePath':src_path(source),'background':bg,'position':pos,'style':attrs}

def parse_slide(sl):
    parent_map={c:p for p in sl.iter() for c in p}
    texts=[parse_text_element(te) for te in sl.iter('RVTextElement')]
    media=[parse_media_element(me,parent_map) for me in sl.iter() if me.tag in ('RVImageElement','RVVideoElement')]
    slide_attrs=sorted_attr_str(sl.attrib, {'UUID','label','notes','hotKey','socialItemCount'})
    sem_parts=[slide_attrs]
    for t in texts: sem_parts += ['T',t['displayName'],t['text'],t['style']]
    for m in media: sem_parts += ['M',m['kind'],m['basename'],str(m['background']),m['position'],m['style']]
    semantic=hashstr('\x1e'.join(sem_parts))
    technical=hashstr('\x1e'.join(sem_parts+['UUID='+sl.attrib.get('UUID','')]+[m['sourcePath'] for m in media]))
    label=norm_nfc(sl.attrib.get('label','')); normtexts=[t['normText'] for t in texts if t['normText']]
    ident_parts=[label,'\x1f'.join(normtexts),str(len(texts)),str(len(media))]
    if not label and not normtexts: ident_parts.append('\x1f'.join(m['basename'] for m in media))
    identity=hashstr('\x1e'.join(ident_parts))
    return {'uuid':sl.attrib.get('UUID',''),'label':sl.attrib.get('label',''),'texts':texts,'media':media,
            'semantic':semantic,'technical':technical,'identity':identity,'rawAttrs':dict(sl.attrib)}

def parse_document(path):
    root=ET.parse(path).getroot(); groups=[]; global_idx=0
    for gi,g in enumerate(root.iter('RVSlideGrouping'),1):
        gl={'uuid':g.attrib.get('uuid',''),'name':g.attrib.get('name',''),'color':g.attrib.get('color',''),'index':gi,'slides':[]}
        for gsi,sl in enumerate(g.iter('RVDisplaySlide'),1):
            global_idx+=1; si=parse_slide(sl)
            si.update({'index':global_idx,'groupIndex':gi,'groupSlide':gsi,'groupUUID':gl['uuid'],'groupName':gl['name']})
            gl['slides'].append(si)
        groups.append(gl)
    root_sem_attrs={k:v for k,v in root.attrib.items() if k not in {'uuid','lastDateUsed','usedCount','buildNumber'}}
    doc_sem=hashstr(json.dumps({'root':root_sem_attrs,'groups':[(g['name'],g['color'],[s['semantic'] for s in g['slides']]) for g in groups]},ensure_ascii=False,sort_keys=True,separators=(',',':')))
    return {'path':str(path),'rootAttrs':dict(root.attrib),'groups':groups,'slides':[s for g in groups for s in g['slides']],'semantic':doc_sem}

def lcs_pairs(a,b):
    m,n=len(a),len(b); dp=[[0]*(n+1) for _ in range(m+1)]
    for i in range(m-1,-1,-1):
        for j in range(n-1,-1,-1): dp[i][j]=dp[i+1][j+1]+1 if a[i]==b[j] else max(dp[i+1][j],dp[i][j+1])
    pairs=[]; i=j=0
    while i<m and j<n:
        if a[i]==b[j]: pairs.append((i,j)); i+=1; j+=1
        elif dp[i+1][j]>=dp[i][j+1]: i+=1
        else: j+=1
    return pairs

def lis_stationary(pairs):
    # pairs is list of (old_idx,new_idx), return set of pairs in LIS by new order
    seq=sorted(pairs,key=lambda x:x[1])
    if not seq: return set()
    L=len(seq); dp=[1]*L; prev=[-1]*L; best=0
    for x in range(L):
        for y in range(x):
            if seq[y][0]<seq[x][0] and dp[y]+1>dp[x]: dp[x]=dp[y]+1; prev[x]=y
        if dp[x]>dp[best]: best=x
    st=set(); k=best
    while k!=-1: st.add(seq[k]); k=prev[k]
    return st

def compare_group(og,ng):
    old,new=og['slides'],ng['slides']; matched={}; usedo=set(); usedn=set()
    om=collections.defaultdict(list); nm=collections.defaultdict(list)
    for i,s in enumerate(old):
        if s['uuid']: om[s['uuid']].append(i)
    for j,s in enumerate(new):
        if s['uuid']: nm[s['uuid']].append(j)
    for k,ois in om.items():
        nis=nm.get(k,[])
        if len(ois)==1 and len(nis)==1:
            i,j=ois[0],nis[0]; matched[i]=j; usedo.add(i); usedn.add(j)
    old_u=[i for i in range(len(old)) if i not in usedo]; new_u=[j for j in range(len(new)) if j not in usedn]
    for pi,pj in lcs_pairs([old[i]['identity'] for i in old_u],[new[j]['identity'] for j in new_u]):
        i,j=old_u[pi],new_u[pj]; matched[i]=j; usedo.add(i); usedn.add(j)
    # unique semantic fallback
    om=collections.defaultdict(list); nm=collections.defaultdict(list)
    for i,s in enumerate(old):
        if i not in usedo: om[s['semantic']].append(i)
    for j,s in enumerate(new):
        if j not in usedn: nm[s['semantic']].append(j)
    for k,ois in om.items():
        nis=nm.get(k,[])
        if len(ois)==1 and len(nis)==1:
            i,j=ois[0],nis[0]; matched[i]=j; usedo.add(i); usedn.add(j)
    deleted=[i for i in range(len(old)) if i not in usedo]; added=[j for j in range(len(new)) if j not in usedn]
    stationary=lis_stationary([(i,j) for i,j in matched.items()])
    rows=[]; counts={'added':len(added),'deleted':len(deleted),'modified':0,'moved':0,'technical':0}
    for oi,nj in sorted(matched.items(),key=lambda x:x[1]):
        o,n=old[oi],new[nj]; modified=o['semantic']!=n['semantic']; moved=(oi,nj) not in stationary; technical=(not modified and o['technical']!=n['technical'])
        if modified: counts['modified']+=1
        if moved: counts['moved']+=1
        if technical: counts['technical']+=1
        rows.append((oi,nj,modified,moved,technical))
    return matched,deleted,added,rows,counts

def layout_sig(s):
    return hashstr(json.dumps({'text':[(t['displayName'],t['position'],t['style']) for t in s['texts']],
                               'media':[(m['kind'],m['background'],m['position'],m['style']) for m in s['media']],
                               'attrs':{k:v for k,v in s['rawAttrs'].items() if k not in {'UUID','label','notes','hotKey','socialItemCount'}}},ensure_ascii=False,sort_keys=True))

def classify_slide(o,n):
    obg=[m for m in o['media'] if m['background']]; nbg=[m for m in n['media'] if m['background']]
    oldbg=obg[0]['basename'] if obg else ''; newbg=nbg[0]['basename'] if nbg else ''
    text_changes=[]
    for i in range(max(len(o['texts']),len(n['texts']))):
        ot=o['texts'][i] if i<len(o['texts']) else None; nt=n['texts'][i] if i<len(n['texts']) else None
        if ot is None or nt is None or ot['text']!=nt['text']:
            text_changes.append({'index':i+1,'old':ot['text'] if ot else None,'new':nt['text'] if nt else None})
    omn=[(m['kind'],m['basename']) for m in o['media'] if not m['background']]; nmn=[(m['kind'],m['basename']) for m in n['media'] if not m['background']]
    path_changes=[]
    # match same media basename/kind greedily to catch path-only changes
    for om in o['media']:
        for nm in n['media']:
            if om['kind']==nm['kind'] and om['basename']==nm['basename'] and om['sourcePath']!=nm['sourcePath']:
                path_changes.append({'basename':om['basename'],'old':om['sourcePath'],'new':nm['sourcePath']}); break
    return {'backgroundChanged':oldbg!=newbg,'oldBackground':oldbg,'newBackground':newbg,
            'textChanges':text_changes,'mediaChanged':omn!=nmn,'layoutChanged':layout_sig(o)!=layout_sig(n),'pathChanges':path_changes}

def compare_docs(od,nd):
    ogs,ngs=od['groups'],nd['groups']; gm=[]; usedo=set();usedn=set()
    om=collections.defaultdict(list);nm=collections.defaultdict(list)
    for i,g in enumerate(ogs):
        if g['uuid']:om[g['uuid']].append(i)
    for j,g in enumerate(ngs):
        if g['uuid']:nm[g['uuid']].append(j)
    for k,ois in om.items():
        nis=nm.get(k,[])
        if len(ois)==1 and len(nis)==1:
            i,j=ois[0],nis[0];gm.append((i,j));usedo.add(i);usedn.add(j)
    for i in range(min(len(ogs),len(ngs))):
        if i not in usedo and i not in usedn and ogs[i]['name']==ngs[i]['name']:
            gm.append((i,i));usedo.add(i);usedn.add(i)
    report={'oldSlides':len(od['slides']),'newSlides':len(nd['slides']),'groups':[],'counts':{'added':0,'deleted':0,'modified':0,'moved':0,'technical':0}}
    for gi,gj in sorted(gm,key=lambda x:x[1]):
        og,ng=ogs[gi],ngs[gj]; matched,deleted,added,rows,counts=compare_group(og,ng)
        gr={'oldGroup':gi+1,'newGroup':gj+1,'name':ng['name'],'uuid':ng['uuid'],'counts':counts,'deleted':[],'added':[],'matched':[]}
        for i in deleted:
            s=og['slides'][i];gr['deleted'].append({'oldIndex':s['index'],'groupSlide':i+1,'label':s['label'],'texts':[t['text'] for t in s['texts']]})
        for j in added:
            s=ng['slides'][j];gr['added'].append({'newIndex':s['index'],'groupSlide':j+1,'label':s['label'],'texts':[t['text'] for t in s['texts']]})
        for oi,nj,mod,mov,tech in rows:
            o,n=og['slides'][oi],ng['slides'][nj];e={'oldIndex':o['index'],'newIndex':n['index'],'label':n['label'] or o['label'],'modified':mod,'moved':mov,'technicalOnly':tech,'uuidChanged':o['uuid']!=n['uuid']}
            if mod or tech:e['detail']=classify_slide(o,n)
            gr['matched'].append(e)
        report['groups'].append(gr)
        for k in report['counts']: report['counts'][k]+=counts[k]
    for i,g in enumerate(ogs):
        if i not in usedo: report['counts']['deleted']+=len(g['slides'])
    for j,g in enumerate(ngs):
        if j not in usedn: report['counts']['added']+=len(g['slides'])
    return report

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description='Reference PP6 .pro6 semantic diff (PC validation tool)')
    ap.add_argument('old')
    ap.add_argument('new')
    ap.add_argument('-o','--output',default='document-diff-reference.json')
    args=ap.parse_args()
    old=parse_document(args.old); new=parse_document(args.new); r=compare_docs(old,new)
    report={'schema':'pp6-document-diff-reference-v0.2','oldFile':args.old,'newFile':args.new,
            'oldSlides':r['oldSlides'],'newSlides':r['newSlides'],'summary':r['counts'],'groups':r['groups']}
    with open(args.output,'w',encoding='utf-8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps(report['summary'],ensure_ascii=False,indent=2))
    print('written:',args.output)
