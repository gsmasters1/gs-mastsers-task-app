const fs = require('fs');
let c = fs.readFileSync('gs-masters-task-app/src/App.js', 'utf8');

const oldStart = c.indexOf('function AdminReceipts({ receipts, setReceipts, jobs, users }) {');
const oldEnd   = c.indexOf('\nfunction AdminPhotos(', oldStart);

const newFn = `function AdminReceipts({ receipts, setReceipts, jobs, tasks, users, user }) {
  const [modal, setModal] = useState(false);
  const [nr, setNr] = useState({ jobId: '', taskId: '', crewId: '', store: '', amount: '', note: '', paidBy: 'company', dataUrl: null });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const today = new Date().toISOString().split('T')[0];
  const jobTasks = tasks.filter(t => t.jobId === nr.jobId);

  const addReceipt = async () => {
    if (!nr.jobId || !nr.store || !nr.amount) return;
    setBusy(true);
    const id = 'r' + Date.now();
    const receipt = { id, jobId: nr.jobId, taskId: nr.taskId || null, crewId: nr.crewId || user.id,
      dataUrl: nr.dataUrl, store: nr.store, amount: nr.amount, note: nr.note,
      paidBy: nr.paidBy, reimbursementStatus: nr.paidBy === 'crew' ? 'pending' : 'na', createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, job_id: nr.jobId, task_id: nr.taskId || null, crew_id: nr.crewId || user.id,
      data_url: nr.dataUrl, store: nr.store, amount: parseFloat(nr.amount) || 0, note: nr.note,
      paid_by: nr.paidBy, reimbursement_status: nr.paidBy === 'crew' ? 'pending' : 'na' };
    try { await sbPost('field_receipts', row); } catch { enqueue({ table: 'field_receipts', payload: row }); }
    setNr({ jobId: '', taskId: '', crewId: '', store: '', amount: '', note: '', paidBy: 'company', dataUrl: null });
    setModal(false); setBusy(false);
  };

  const photoCapture = async e => {
    const file = e.target.files[0]; if (!file) return;
    const { dataUrl } = await compressImage(file, 1000, 0.6);
    setNr(p => ({ ...p, dataUrl }));
  };

  const markReimbursed = async (id) => {
    setReceipts(p => p.map(r => r.id === id ? { ...r, reimbursementStatus: 'paid', reimbursementDate: today } : r));
    try { await sbPatch('field_receipts', id, { reimbursement_status: 'paid', reimbursement_date: today }); } catch {}
  };

  const exportBills = () => {
    const payload = receipts.map(r => ({
      receipt_id: r.id, vendor: r.store || '', amount: +r.amount || 0,
      job_id: r.jobId, job_name: jobs.find(j => j.id === r.jobId)?.name || '',
      memo: r.note || '', receipt_date: r.createdAt,
      submitted_by: users.find(u => u.id === r.crewId)?.name || 'Admin',
      image: r.dataUrl ? '[base64 attached]' : null, status: 'pending_review',
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'gsm-bills-export-' + today + '.json'; a.click(); URL.revokeObjectURL(url);
  };

  const pendingReimb = receipts.filter(r => r.paidBy === 'crew' && r.reimbursementStatus !== 'paid');
  const total = receipts.reduce((s, r) => s + (+r.amount || 0), 0);

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}>
        <h2 className="h2">Receipts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {receipts.length > 0 && <button className="btn btn-s btn-sm" onClick={exportBills}><Icon n="receipt" s={14} /> Export for Bills</button>}
          <button className="btn btn-p" onClick={() => setModal(true)}><Icon n="plus" s={16} /> Add Receipt</button>
        </div>
      </div>

      {pendingReimb.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'rgba(249,115,22,.1)', border: '1px solid rgba(249,115,22,.3)', borderRadius: 10, color: 'var(--orange)', fontSize: 13 }}>
          Reimbursement owed to crew: <strong>${pendingReimb.reduce((s,r)=>s+(+r.amount||0),0).toFixed(2)}</strong> across {pendingReimb.length} receipt{pendingReimb.length!==1?'s':''}
        </div>
      )}

      {receipts.length === 0
        ? <div className="empty"><Icon n="receipt" s={48} c="var(--slate)" /><p>No receipts yet. Add one above or have crew capture in the field.</p></div>
        : <div className="card">
          <div className="flexb" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <span className="muted">{receipts.length} receipt{receipts.length!==1?'s':''}</span>
            <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, color: 'var(--accent)' }}>${total.toFixed(2)}</span>
          </div>
          <div className="tbl-wrap"><table><thead><tr>
            <th>Date</th><th>By</th><th>Job</th><th>Vendor</th><th>Memo</th>
            <th>Paid By</th><th>Reimburse</th><th>Photo</th><th style={{ textAlign: 'right' }}>Amount</th>
          </tr></thead>
          <tbody>{receipts.map(r => {
            const j=jobs.find(x=>x.id===r.jobId), cr=users.find(u=>u.id===r.crewId);
            const needsReimb=r.paidBy==='crew'&&r.reimbursementStatus!=='paid';
            return <tr key={r.id}>
              <td data-l="Date" className="muted">{r.createdAt}</td>
              <td data-l="By">{cr?.name||'Admin'}</td>
              <td data-l="Job"><span className="tag-l" style={{ fontSize: 11 }}>{j?.name}</span></td>
              <td data-l="Vendor">{r.store}</td>
              <td data-l="Memo" className="muted">{r.note}</td>
              <td data-l="Paid By"><span className={`tag ${r.paidBy==='crew'?'tag-overdue':'tag-done'}`}>{r.paidBy==='crew'?'Crew':'Company'}</span></td>
              <td data-l="Reimburse">{r.paidBy==='crew'
                ?needsReimb
                  ?<button className="btn btn-sm" style={{ background:'rgba(249,115,22,.15)',color:'var(--orange)',padding:'4px 10px',fontSize:11,border:'1px solid rgba(249,115,22,.4)' }} onClick={()=>markReimbursed(r.id)}>Mark Paid</button>
                  :<span className="tag tag-done">Reimbursed</span>
                :<span className="muted">—</span>}</td>
              <td data-l="Photo">{r.dataUrl?<img src={r.dataUrl} alt="rcpt" style={{ width:40,height:40,objectFit:'cover',borderRadius:6 }} />:<span className="muted">—</span>}</td>
              <td data-l="Amount" style={{ textAlign:'right',fontWeight:700,color:needsReimb?'var(--orange)':'var(--accent)' }}>${(+r.amount).toFixed(2)}</td>
            </tr>;
          })}</tbody></table></div>
        </div>
      }

      {modal && <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
        <div className="modal"><div className="mt">Add Receipt</div>
          <div className="grid2">
            <div className="fg"><label className="fl">Job</label>
              <select className="fi" value={nr.jobId} onChange={e=>setNr(p=>({...p,jobId:e.target.value,taskId:''}))}>
                <option value="">Select Job</option>{jobs.filter(j=>j.status!=='closed').map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
            <div className="fg"><label className="fl">Task (optional)</label>
              <select className="fi" value={nr.taskId} onChange={e=>setNr(p=>({...p,taskId:e.target.value}))} disabled={!nr.jobId}>
                <option value="">General / No task</option>{jobTasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
          </div>
          <div className="fg"><label className="fl">Submitted By</label>
            <select className="fi" value={nr.crewId} onChange={e=>setNr(p=>({...p,crewId:e.target.value}))}>
              <option value="">Admin (me)</option>
              {users.filter(u=>u.role==='crew').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
          <div className="grid2">
            <div className="fg"><label className="fl">Vendor / Store</label>
              <input className="fi" value={nr.store} onChange={e=>setNr(p=>({...p,store:e.target.value}))} placeholder="Home Depot" /></div>
            <div className="fg"><label className="fl">Amount ($)</label>
              <input className="fi" type="number" value={nr.amount} onChange={e=>setNr(p=>({...p,amount:e.target.value}))} placeholder="0.00" /></div>
          </div>
          <div className="fg"><label className="fl">Notes / Memo</label>
            <input className="fi" value={nr.note} onChange={e=>setNr(p=>({...p,note:e.target.value}))} placeholder="What was purchased" /></div>
          <div className="fg"><label className="fl">Who Paid?</label>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
              <button className={`btn btn-sm ${nr.paidBy==='company'?'btn-p':'btn-s'}`} onClick={()=>setNr(p=>({...p,paidBy:'company'}))}>Company Card</button>
              <button className={`btn btn-sm ${nr.paidBy==='crew'?'btn-a':'btn-s'}`} onClick={()=>setNr(p=>({...p,paidBy:'crew'}))}>Crew Paid — Needs Reimbursement</button>
            </div></div>
          <div className="fg"><label className="fl">Receipt Photo (optional)</label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={photoCapture} />
            {nr.dataUrl
              ?<div style={{ display:'flex',gap:10,alignItems:'center' }}>
                  <img src={nr.dataUrl} alt="receipt" style={{ width:64,height:64,objectFit:'cover',borderRadius:8 }} />
                  <button className="btn btn-s btn-sm" onClick={()=>setNr(p=>({...p,dataUrl:null}))}>Remove</button>
                </div>
              :<div style={{ display:'flex',gap:8 }}>
                  <button className="btn btn-s btn-sm" onClick={()=>fileRef.current?.click()}><Icon n="camera" s={14} /> Take Photo</button>
                  <button className="btn btn-s btn-sm" onClick={()=>{fileRef.current?.removeAttribute('capture');fileRef.current?.click();}}><Icon n="photo" s={14} /> From Library</button>
                </div>
            }</div>
          <div className="macts">
            <button className="btn btn-s" onClick={()=>setModal(false)}>Cancel</button>
            <button className="btn btn-p" onClick={addReceipt} disabled={busy||!nr.jobId||!nr.store||!nr.amount}>
              {busy?<span className="spin" />:<><Icon n="check" s={14} /> Save Receipt</>}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}

`;

c = c.slice(0, oldStart) + newFn + c.slice(oldEnd);
fs.writeFileSync('gs-masters-task-app/src/App.js', c, 'utf8');
console.log('Done. File length:', c.length);
