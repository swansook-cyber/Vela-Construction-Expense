import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const api = async (path, options = {}) => {
  const response = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'ไม่สามารถบันทึกข้อมูลได้');
  }
  if (response.status === 204) return null;
  return response.json();
};

const money = (value) =>
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(Number(value || 0));

const today = () => new Date().toISOString().slice(0, 10);

const thaiDate = (value) => {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(y, m - 1, d));
};

function QuickExpenseModal({ projects, costCodes, vendors, onClose, onSaved }) {
  const [form, setForm] = useState({
    project_id: projects[0]?.id || '',
    cost_code_id: '',
    vendor_id: '',
    expense_date: today(),
    document_no: '',
    description: '',
    total_amount: '',
    vatMode: 'NO_VAT',
    whtRate: '0',
    payment_status: 'UNPAID',
    payment_method: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = Number(form.total_amount || 0);
  const subtotal = form.vatMode === 'VAT_INCLUDED' ? total / 1.07 : total;
  const vat = form.vatMode === 'VAT_INCLUDED' ? total - subtotal : 0;
  const wht = subtotal * Number(form.whtRate || 0) / 100;
  const vendorPayable = Math.max(total - wht, 0);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const netPaid = form.payment_status === 'PAID' ? vendorPayable : 0;
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          project_id: Number(form.project_id),
          cost_code_id: Number(form.cost_code_id),
          vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
          expense_date: form.expense_date,
          document_no: form.document_no || null,
          description: form.description,
          subtotal: subtotal.toFixed(2),
          vat_amount: vat.toFixed(2),
          withholding_tax: wht.toFixed(2),
          total_amount: total.toFixed(2),
          net_paid: netPaid.toFixed(2),
          payment_status: form.payment_status,
          payment_method: form.payment_method || null,
          notes: form.notes || null,
          paperless_document_id: null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal quick-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Quick Expense Entry</p>
            <h2>บันทึกค่าใช้จ่ายแบบเร็ว</h2>
            <p>กรอกจากเอกสารจริง แล้วค่อยแนบเอกสารภายหลังได้</p>
          </div>
          <button className="ghost icon" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit} className="form-grid">
          <label>วันที่
            <input type="date" value={form.expense_date} onChange={(e) => set('expense_date', e.target.value)} required />
          </label>
          <label>ผู้ขาย / ผู้รับเหมา
            <select value={form.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label>Cost Code *
            <select value={form.cost_code_id} onChange={(e) => set('cost_code_id', e.target.value)} required>
              <option value="">เลือกหมวดงาน</option>
              {costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </label>
          <label>เลขที่เอกสาร
            <input value={form.document_no} onChange={(e) => set('document_no', e.target.value)} placeholder="Invoice / Receipt No." />
          </label>
          <label className="wide">รายละเอียด *
            <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="เช่น ค่าปูน / ค่าแรง / อุปกรณ์ไฟฟ้า" required />
          </label>
          <label>ยอดรวมเอกสาร *
            <input type="number" inputMode="decimal" min="0" step="0.01" value={form.total_amount} onChange={(e) => set('total_amount', e.target.value)} required />
          </label>
          <label>VAT
            <select value={form.vatMode} onChange={(e) => set('vatMode', e.target.value)}>
              <option value="NO_VAT">ไม่มี VAT / ไม่แยก VAT</option>
              <option value="VAT_INCLUDED">ยอดนี้รวม VAT 7% แล้ว</option>
            </select>
          </label>
          <label>หัก ณ ที่จ่าย
            <select value={form.whtRate} onChange={(e) => set('whtRate', e.target.value)}>
              <option value="0">ไม่หัก</option>
              <option value="1">1%</option>
              <option value="3">3%</option>
              <option value="5">5%</option>
            </select>
          </label>
          <label>สถานะการจ่าย
            <select value={form.payment_status} onChange={(e) => set('payment_status', e.target.value)}>
              <option value="UNPAID">ยังไม่จ่าย</option>
              <option value="PAID">จ่ายแล้ว</option>
            </select>
          </label>
          <label>วิธีจ่าย
            <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
              <option value="">ไม่ระบุ</option>
              <option value="TRANSFER">โอน</option>
              <option value="CASH">เงินสด</option>
              <option value="CREDIT">เครดิต / เจ้าหนี้</option>
              <option value="CHEQUE">เช็ค</option>
            </select>
          </label>

          <div className="calc wide quick-summary">
            <span>ก่อน VAT <b>{money(subtotal)}</b></span>
            <span>VAT <b>{money(vat)}</b></span>
            <span>หัก ณ ที่จ่าย <b>-{money(wht)}</b></span>
            <span className="total-line">ยอดเอกสาร <b>{money(total)}</b></span>
            <span>จ่ายผู้ขายสุทธิ <b>{money(vendorPayable)}</b></span>
          </div>

          <label className="wide">หมายเหตุ
            <textarea rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {error && <div className="error wide">{error}</div>}
          <div className="actions wide">
            <button type="button" className="ghost" onClick={onClose}>ยกเลิก</button>
            <button type="submit" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึกค่าใช้จ่าย'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpenseModal({ projects, costCodes, vendors, existing = null, onClose, onSaved }) {
  const existingSubtotal = Number(existing?.subtotal || 0);
  const existingVatRate = existingSubtotal > 0 ? String(Math.round(Number(existing?.vat_amount || 0) / existingSubtotal * 100)) : '7';
  const existingWhtRate = existingSubtotal > 0 ? String(Math.round(Number(existing?.withholding_tax || 0) / existingSubtotal * 100)) : '0';
  const [form, setForm] = useState({
    project_id: existing?.project_id || projects[0]?.id || '',
    cost_code_id: existing?.cost_code_id || '',
    vendor_id: existing?.vendor_id || '',
    expense_date: existing?.expense_date || today(),
    document_no: existing?.document_no || '',
    description: existing?.description || '',
    subtotal: existing?.subtotal || '',
    vatRate: ['0','7'].includes(existingVatRate) ? existingVatRate : '0',
    whtRate: ['0','1','3','5'].includes(existingWhtRate) ? existingWhtRate : '0',
    payment_status: existing?.payment_status || 'UNPAID',
    payment_method: existing?.payment_method || '',
    paid_amount: existing?.net_paid || '',
    notes: existing?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const subtotal = Number(form.subtotal || 0);
  const vat = subtotal * Number(form.vatRate || 0) / 100;
  const wht = subtotal * Number(form.whtRate || 0) / 100;
  const total = subtotal + vat;
  const vendorPayable = Math.max(total - wht, 0);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      let netPaid = Number(form.paid_amount || 0);
      if (form.payment_status === 'PAID') netPaid = vendorPayable;
      if (form.payment_status === 'UNPAID') netPaid = 0;

      await api(existing ? `/expenses/${existing.id}` : '/expenses', {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify({
          project_id: Number(form.project_id),
          cost_code_id: Number(form.cost_code_id),
          vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
          expense_date: form.expense_date,
          document_no: form.document_no || null,
          description: form.description,
          subtotal: subtotal.toFixed(2),
          vat_amount: vat.toFixed(2),
          withholding_tax: wht.toFixed(2),
          total_amount: total.toFixed(2),
          net_paid: netPaid.toFixed(2),
          payment_status: form.payment_status,
          payment_method: form.payment_method || null,
          notes: form.notes || null,
          paperless_document_id: existing?.paperless_document_id || null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Expense Entry</p>
            <h2>{existing ? `แก้ไข ${existing.expense_no}` : 'บันทึกค่าใช้จ่าย'}</h2>
          </div>
          <button className="ghost icon" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit} className="form-grid">
          <label>โครงการ
            <select value={form.project_id} onChange={(e) => set('project_id', e.target.value)} required>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>วันที่
            <input type="date" value={form.expense_date} onChange={(e) => set('expense_date', e.target.value)} required />
          </label>
          <label className="wide">รายละเอียด
            <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="เช่น ปูนซีเมนต์ 100 ถุง" required />
          </label>
          <label>Cost Code
            <select value={form.cost_code_id} onChange={(e) => set('cost_code_id', e.target.value)} required>
              <option value="">เลือกหมวดงาน</option>
              {costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </label>
          <label>ผู้ขาย / ผู้รับเหมา
            <select value={form.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label>เลขที่เอกสาร
            <input value={form.document_no} onChange={(e) => set('document_no', e.target.value)} placeholder="Invoice / Receipt No." />
          </label>
          <label>ยอดก่อน VAT
            <input type="number" min="0" step="0.01" value={form.subtotal} onChange={(e) => set('subtotal', e.target.value)} required />
          </label>
          <label>VAT
            <select value={form.vatRate} onChange={(e) => set('vatRate', e.target.value)}>
              <option value="0">ไม่มี VAT</option>
              <option value="7">VAT 7%</option>
            </select>
          </label>
          <label>หัก ณ ที่จ่าย
            <select value={form.whtRate} onChange={(e) => set('whtRate', e.target.value)}>
              <option value="0">ไม่หัก</option>
              <option value="1">1%</option>
              <option value="3">3%</option>
              <option value="5">5%</option>
            </select>
          </label>

          <div className="calc wide">
            <span>ก่อน VAT <b>{money(subtotal)}</b></span>
            <span>VAT <b>{money(vat)}</b></span>
            <span>หัก ณ ที่จ่าย <b>-{money(wht)}</b></span>
            <span className="total-line">ยอดเอกสาร <b>{money(total)}</b></span>
            <span>จ่ายผู้ขายสุทธิ <b>{money(vendorPayable)}</b></span>
          </div>

          <label>สถานะการจ่าย
            <select value={form.payment_status} onChange={(e) => set('payment_status', e.target.value)}>
              <option value="UNPAID">ยังไม่จ่าย</option>
              <option value="PARTIAL">จ่ายบางส่วน</option>
              <option value="PAID">จ่ายแล้ว</option>
            </select>
          </label>
          <label>วิธีจ่าย
            <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
              <option value="">ไม่ระบุ</option>
              <option value="TRANSFER">โอน</option>
              <option value="CASH">เงินสด</option>
              <option value="CREDIT">เครดิต / เจ้าหนี้</option>
              <option value="CHEQUE">เช็ค</option>
            </select>
          </label>
          {form.payment_status === 'PARTIAL' && (
            <label>จ่ายแล้ว
              <input type="number" min="0" step="0.01" max={vendorPayable} value={form.paid_amount} onChange={(e) => set('paid_amount', e.target.value)} required />
            </label>
          )}
          <label className="wide">หมายเหตุ
            <textarea rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {error && <div className="error wide">{error}</div>}
          <div className="actions wide">
            <button type="button" className="ghost" onClick={onClose}>ยกเลิก</button>
            <button type="submit" disabled={saving}>{saving ? 'กำลังบันทึก…' : (existing ? 'บันทึกการแก้ไข' : 'บันทึกค่าใช้จ่าย')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VendorModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', tax_id: '', phone: '', address: '', notes: '' });
  const [error, setError] = useState('');
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/vendors', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          tax_id: form.tax_id || null,
          phone: form.phone || null,
          address: form.address || null,
          notes: form.notes || null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Vendor</p><h2>เพิ่มผู้ขาย / ผู้รับเหมา</h2></div>
          <button className="ghost icon" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="form-grid">
          <label className="wide">ชื่อ
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
          </label>
          <label>เลขประจำตัวผู้เสียภาษี
            <input value={form.tax_id} onChange={(e) => set('tax_id', e.target.value)} />
          </label>
          <label>โทรศัพท์
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className="wide">ที่อยู่
            <textarea rows="2" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </label>
          {error && <div className="error wide">{error}</div>}
          <div className="actions wide">
            <button type="button" className="ghost" onClick={onClose}>ยกเลิก</button>
            <button type="submit">บันทึกผู้ขาย</button>
          </div>
        </form>
      </div>
    </div>
  );
}


function AttachDocumentModal({ expense, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [taskId, setTaskId] = useState('');
  const [documentId, setDocumentId] = useState(expense.paperless_document_id || null);

  async function waitForDocument(task) {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await api(`/documents/tasks/${encodeURIComponent(task)}`);
      if (result.paperless_document_id) {
        setDocumentId(result.paperless_document_id);
        setMessage(`แนบเอกสารสำเร็จ — Paperless Document #${result.paperless_document_id}`);
        await onSaved();
        return;
      }
    }
    setMessage('อัปโหลดสำเร็จแล้ว แต่ Paperless ยังประมวลผลอยู่ กรุณาเปิดรายการนี้ใหม่ภายหลังเพื่อตรวจสถานะ');
  }

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData();
      data.append('document', file);
      data.append('title', `${expense.expense_no} - ${expense.description}`);
      data.append('created', expense.expense_date);
      data.append('expense_id', String(expense.id));

      const response = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        body: data,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'อัปโหลดเอกสารไม่สำเร็จ');

      setTaskId(body.task_id);
      setMessage('ส่งเอกสารเข้า Paperless แล้ว กำลังรอเลข Document…');
      await onSaved();
      await waitForDocument(body.task_id);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (!taskId) return;
    setBusy(true);
    try {
      const result = await api(`/documents/tasks/${encodeURIComponent(taskId)}`);
      if (result.paperless_document_id) {
        setDocumentId(result.paperless_document_id);
        setMessage(`แนบเอกสารสำเร็จ — Paperless Document #${result.paperless_document_id}`);
        await onSaved();
      } else {
        setMessage('Paperless ยังประมวลผลเอกสารอยู่');
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Attach Document</p>
            <h2>แนบเอกสาร</h2>
            <p>{expense.expense_no} — {expense.description}</p>
          </div>
          <button className="ghost icon" onClick={onClose}>×</button>
        </div>

        <div className="attach-summary">
          <span>วันที่ <b>{expense.expense_date}</b></span>
          <span>ยอด <b>{money(expense.total_amount)}</b></span>
          <span>เอกสารปัจจุบัน <b>{documentId ? `DOC #${documentId}` : 'ยังไม่มี'}</b></span>
        </div>

        <form className="attach-form" onSubmit={submit}>
          <label>ไฟล์เอกสาร
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </label>
          <p className="footnote">รองรับ PDF, JPG, PNG, WEBP สูงสุด 20 MB ไฟล์จะเก็บใน Paperless-ngx</p>

          {message && <div className="info-message">{message}</div>}

          <div className="actions">
            {taskId && !documentId && (
              <button type="button" className="ghost" onClick={checkStatus} disabled={busy}>ตรวจสถานะ</button>
            )}
            <button type="button" className="ghost" onClick={onClose}>ปิด</button>
            <button type="submit" disabled={!file || busy}>
              {busy ? 'กำลังอัปโหลด…' : (documentId ? 'เปลี่ยนเอกสาร' : 'แนบเอกสาร')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function DocumentPanel({ expenses, project, costCodes, vendors, onUpdated }) {
  const [configured, setConfigured] = useState(null);
  const [file, setFile] = useState(null);
  const [taskId, setTaskId] = useState('');
  const [taskData, setTaskData] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [expenseId, setExpenseId] = useState('');
  const [review, setReview] = useState(null);
  const [reviewForm, setReviewForm] = useState(null);

  useEffect(() => {
    api('/documents/status')
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, []);

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage('');
    setTaskData(null);
    setReview(null);
    setReviewForm(null);
    try {
      const data = new FormData();
      data.append('document', file);
      data.append('title', file.name);
      if (expenseId) data.append('expense_id', expenseId);
      const response = await fetch('/api/v1/documents/upload', { method: 'POST', body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'อัปโหลดเอกสารไม่สำเร็จ');
      setTaskId(body.task_id);
      setMessage(expenseId ? 'ส่งเอกสารเข้า OCR และผูกกับค่าใช้จ่ายแล้ว' : 'ส่งเอกสารเข้า OCR แล้ว');
      if (onUpdated) onUpdated();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function prepareReview(data) {
    const suggested = data.suggested || {};
    const matchedVendor = vendors.find((v) =>
      (suggested.tax_id && v.tax_id === suggested.tax_id) ||
      (suggested.vendor_name && v.name.trim().toLowerCase() === suggested.vendor_name.trim().toLowerCase())
    );
    const subtotal = Number(suggested.subtotal || 0);
    const vat = Number(suggested.vat_amount || 0);
    const total = Number(suggested.total_amount || 0);
    setReview(data);
    setReviewForm({
      vendor_id: matchedVendor?.id || '',
      vendor_name: suggested.vendor_name || '',
      tax_id: suggested.tax_id || '',
      expense_date: suggested.expense_date || today(),
      document_no: suggested.document_no || '',
      description: suggested.vendor_name ? `ซื้อสินค้า/บริการ — ${suggested.vendor_name}` : '',
      cost_code_id: '',
      subtotal: subtotal || (total && vat ? Math.max(total - vat, 0) : ''),
      vat_amount: vat || '',
      total_amount: total || (subtotal ? subtotal + vat : ''),
      withholding_tax: '0',
      payment_status: 'UNPAID',
      payment_method: '',
      notes: 'สร้างจาก OCR Review — โปรดตรวจสอบกับเอกสารต้นฉบับ',
    });
  }

  async function loadReview(documentId) {
    const data = await api(`/documents/${documentId}/review`);
    prepareReview(data);
    setMessage('OCR เสร็จแล้ว — กรุณาตรวจข้อมูลก่อนบันทึก');
  }

  async function checkTask() {
    if (!taskId) return;
    setBusy(true);
    try {
      const result = await api(`/documents/tasks/${encodeURIComponent(taskId)}`);
      setTaskData(result);
      if (result.paperless_document_id) {
        await loadReview(result.paperless_document_id);
      } else {
        setMessage('OCR ยังประมวลผลอยู่ หรือยังไม่พบ Document ID');
      }
      if (onUpdated) onUpdated();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const setReviewField = (key, value) => setReviewForm((form) => ({ ...form, [key]: value }));

  async function createExpenseFromReview(e) {
    e.preventDefault();
    if (!reviewForm || !review?.paperless_document_id || !project?.id) return;
    if (!reviewForm.cost_code_id) {
      setMessage('กรุณาเลือก Cost Code ก่อนบันทึก');
      return;
    }

    setBusy(true);
    try {
      let vendorId = reviewForm.vendor_id ? Number(reviewForm.vendor_id) : null;
      if (!vendorId && reviewForm.vendor_name.trim()) {
        const created = await api('/vendors', {
          method: 'POST',
          body: JSON.stringify({
            name: reviewForm.vendor_name.trim(),
            tax_id: reviewForm.tax_id.trim() || null,
            phone: null,
            address: null,
            notes: 'สร้างจาก OCR Review',
          }),
        });
        vendorId = created.id;
      }

      const subtotal = Number(reviewForm.subtotal || 0);
      const vat = Number(reviewForm.vat_amount || 0);
      const total = Number(reviewForm.total_amount || (subtotal + vat));
      const wht = Number(reviewForm.withholding_tax || 0);

      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          project_id: Number(project.id),
          cost_code_id: Number(reviewForm.cost_code_id),
          vendor_id: vendorId,
          expense_date: reviewForm.expense_date,
          document_no: reviewForm.document_no.trim() || null,
          description: reviewForm.description.trim() || 'ค่าใช้จ่ายจากเอกสาร OCR',
          subtotal: subtotal.toFixed(2),
          vat_amount: vat.toFixed(2),
          withholding_tax: wht.toFixed(2),
          total_amount: total.toFixed(2),
          net_paid: '0.00',
          payment_status: reviewForm.payment_status,
          payment_method: reviewForm.payment_method || null,
          paperless_document_id: Number(review.paperless_document_id),
          notes: reviewForm.notes.trim() || null,
        }),
      });

      setMessage('บันทึกค่าใช้จ่ายจาก OCR สำเร็จ');
      setReview(null);
      setReviewForm(null);
      setTaskId('');
      setTaskData(null);
      setFile(null);
      if (onUpdated) await onUpdated();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (configured === null) return <section className="panel"><p>กำลังตรวจสอบ Paperless-ngx…</p></section>;

  if (!configured) {
    return (
      <section className="panel document-panel">
        <div className="section-head">
          <div><h2>เอกสาร / OCR</h2><p>Paperless-ngx document engine</p></div>
          <span className="status unpaid">ยังไม่เชื่อมต่อ</span>
        </div>
        <div className="setup-note">
          <strong>Document module พร้อมแล้ว แต่ยังต้องตั้งค่า Paperless-ngx</strong>
          <p>กำหนด PAPERLESS_URL และ PAPERLESS_TOKEN ในไฟล์ .env ของ server แล้ว recreate backend</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel document-panel">
      <div className="section-head">
        <div><h2>เอกสาร</h2><p>เก็บไฟล์ต้นฉบับใน Paperless-ngx และผูกกับค่าใช้จ่ายเมื่อจำเป็น</p></div>
        <span className="status paid">เชื่อมต่อแล้ว</span>
      </div>

      <form className="upload-box" onSubmit={upload}>
        <select value={expenseId} onChange={(e) => setExpenseId(e.target.value)}>
          <option value="">เอกสารใหม่ — สร้างค่าใช้จ่ายหลัง OCR</option>
          {expenses.filter((e) => e.payment_status !== 'VOID').map((e) => (
            <option key={e.id} value={e.id}>{e.expense_no} — {e.description}</option>
          ))}
        </select>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <button type="submit" disabled={!file || busy}>{busy ? 'กำลังทำงาน…' : 'อัปโหลดเข้า OCR'}</button>
      </form>

      {message && <div className="info-message">{message}</div>}

      {taskId && (
        <div className="task-box">
          <div><span>OCR Task</span><code>{taskId}</code></div>
          <button className="ghost" onClick={checkTask} disabled={busy}>
            {busy ? 'กำลังตรวจ…' : 'ตรวจสถานะ OCR'}
          </button>
        </div>
      )}

      {review && reviewForm && (
        <div className="ocr-review">
          <div className="review-title">
            <div>
              <p className="eyebrow">OCR Review</p>
              <h3>ตรวจข้อมูลก่อนสร้างค่าใช้จ่าย</h3>
            </div>
            <span className="status partial">ต้องตรวจสอบ</span>
          </div>

          {review.confidence_notes?.length > 0 && (
            <div className="review-warning">
              {review.confidence_notes.map((note) => <div key={note}>• {note}</div>)}
            </div>
          )}

          <form className="form-grid review-form" onSubmit={createExpenseFromReview}>
            <label>ผู้ขายเดิม
              <select value={reviewForm.vendor_id} onChange={(e) => setReviewField('vendor_id', e.target.value)}>
                <option value="">ยังไม่เลือก — สร้างจากชื่อ OCR</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label>ชื่อผู้ขายจาก OCR
              <input value={reviewForm.vendor_name} onChange={(e) => setReviewField('vendor_name', e.target.value)} />
            </label>
            <label>เลขผู้เสียภาษี
              <input value={reviewForm.tax_id} onChange={(e) => setReviewField('tax_id', e.target.value)} inputMode="numeric" />
            </label>
            <label>วันที่เอกสาร
              <input type="date" value={reviewForm.expense_date} onChange={(e) => setReviewField('expense_date', e.target.value)} required />
            </label>
            <label>เลขที่เอกสาร
              <input value={reviewForm.document_no} onChange={(e) => setReviewField('document_no', e.target.value)} />
            </label>
            <label>Cost Code *
              <select value={reviewForm.cost_code_id} onChange={(e) => setReviewField('cost_code_id', e.target.value)} required>
                <option value="">เลือกหมวดงาน</option>
                {costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </label>
            <label className="wide">รายละเอียด
              <input value={reviewForm.description} onChange={(e) => setReviewField('description', e.target.value)} required />
            </label>
            <label>ก่อน VAT
              <input type="number" min="0" step="0.01" value={reviewForm.subtotal} onChange={(e) => setReviewField('subtotal', e.target.value)} />
            </label>
            <label>VAT
              <input type="number" min="0" step="0.01" value={reviewForm.vat_amount} onChange={(e) => setReviewField('vat_amount', e.target.value)} />
            </label>
            <label>ยอดรวมเอกสาร
              <input type="number" min="0" step="0.01" value={reviewForm.total_amount} onChange={(e) => setReviewField('total_amount', e.target.value)} required />
            </label>
            <label>หัก ณ ที่จ่าย
              <input type="number" min="0" step="0.01" value={reviewForm.withholding_tax} onChange={(e) => setReviewField('withholding_tax', e.target.value)} />
            </label>
            <label>สถานะจ่าย
              <select value={reviewForm.payment_status} onChange={(e) => setReviewField('payment_status', e.target.value)}>
                <option value="UNPAID">ยังไม่จ่าย — ตรวจ OCR ก่อน</option>
              </select>
            </label>
            <label>วิธีจ่าย
              <select value={reviewForm.payment_method} onChange={(e) => setReviewField('payment_method', e.target.value)}>
                <option value="">ไม่ระบุ</option>
                <option value="TRANSFER">โอน</option>
                <option value="CASH">เงินสด</option>
                <option value="CREDIT">เครดิต / เจ้าหนี้</option>
                <option value="CHEQUE">เช็ค</option>
              </select>
            </label>
            <label className="wide">หมายเหตุ
              <textarea rows="2" value={reviewForm.notes} onChange={(e) => setReviewField('notes', e.target.value)} />
            </label>

            <div className="review-confirm wide">
              <div>
                <strong>Paperless Document #{review.paperless_document_id}</strong>
                <p>OCR เป็นเพียงข้อเสนอ ระบบจะไม่บันทึกจนกดปุ่มยืนยัน</p>
              </div>
              <button type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'ยืนยันและสร้างค่าใช้จ่าย'}</button>
            </div>
          </form>

          <details className="ocr-text">
            <summary>ดูข้อความ OCR ต้นฉบับ</summary>
            <pre>{review.ocr_text || 'ไม่มีข้อความ OCR'}</pre>
          </details>
        </div>
      )}

      {taskData && !review && (
        <details className="task-debug">
          <summary>รายละเอียด OCR Task</summary>
          <pre className="task-json">{JSON.stringify(taskData, null, 2)}</pre>
        </details>
      )}

      <p className="footnote">ไฟล์ต้นฉบับเก็บใน Paperless-ngx และค่าใช้จ่ายเก็บใน Vela Construction Expense แยกกัน</p>
    </section>
  );
}


function ReportPanel({ project, expenses, costCodes, vendors }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [costCodeId, setCostCodeId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [view, setView] = useState('DETAIL');

  const costMap = useMemo(() => Object.fromEntries(costCodes.map((c) => [c.id, c])), [costCodes]);
  const vendorMap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);

  const filtered = useMemo(() => expenses.filter((e) => {
    if (e.payment_status === 'VOID') return false;
    if (month && !String(e.expense_date).startsWith(month)) return false;
    if (costCodeId && String(e.cost_code_id) !== String(costCodeId)) return false;
    if (vendorId && String(e.vendor_id || '') !== String(vendorId)) return false;
    if (paymentStatus && e.payment_status !== paymentStatus) return false;
    return true;
  }), [expenses, month, costCodeId, vendorId, paymentStatus]);

  const totals = useMemo(() => filtered.reduce((acc, e) => {
    const total = Number(e.total_amount || 0);
    const wht = Number(e.withholding_tax || 0);
    const paid = Number(e.net_paid || 0);
    acc.subtotal += Number(e.subtotal || 0);
    acc.vat += Number(e.vat_amount || 0);
    acc.wht += wht;
    acc.total += total;
    acc.paid += paid;
    acc.outstanding += Math.max(total - wht - paid, 0);
    return acc;
  }, { subtotal: 0, vat: 0, wht: 0, total: 0, paid: 0, outstanding: 0 }), [filtered]);

  const grouped = useMemo(() => {
    const rows = {};
    for (const e of filtered) {
      const code = costMap[e.cost_code_id] || { code: '-', name: '-' };
      const key = String(e.cost_code_id);
      if (!rows[key]) rows[key] = { code: code.code, name: code.name, count: 0, subtotal: 0, vat: 0, wht: 0, total: 0, paid: 0, outstanding: 0 };
      const row = rows[key];
      const total = Number(e.total_amount || 0);
      const wht = Number(e.withholding_tax || 0);
      const paid = Number(e.net_paid || 0);
      row.count += 1;
      row.subtotal += Number(e.subtotal || 0);
      row.vat += Number(e.vat_amount || 0);
      row.wht += wht;
      row.total += total;
      row.paid += paid;
      row.outstanding += Math.max(total - wht - paid, 0);
    }
    return Object.entries(rows).map(([id, row]) => ({ id, ...row })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [filtered, costMap]);

  const monthLabel = useMemo(() => {
    if (!month) return 'ทุกเดือน';
    const parts = month.split('-').map(Number);
    return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(parts[0], parts[1] - 1, 1));
  }, [month]);

  function exportFilteredCsv() {
    const header = ['วันที่','เลขรายการ','เลขที่เอกสาร','รายละเอียด','Cost Code','ผู้ขาย','ก่อน VAT','VAT','WHT','ยอดรวม','จ่ายแล้ว','ค้างจ่าย','สถานะ'];
    const rows = filtered.map((e) => {
      const code = costMap[e.cost_code_id];
      const vendor = vendorMap[e.vendor_id];
      const outstanding = Math.max(Number(e.total_amount || 0) - Number(e.withholding_tax || 0) - Number(e.net_paid || 0), 0);
      return [
        thaiDate(e.expense_date), e.expense_no, e.document_no || '', e.description,
        code ? `${code.code} ${code.name}` : '', vendor?.name || '',
        e.subtotal, e.vat_amount, e.withholding_tax, e.total_amount, e.net_paid,
        outstanding.toFixed(2), e.payment_status
      ];
    });
    const esc = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const csv = '\ufeff' + [header, ...rows].map((row) => row.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.code || 'project'}-${month || 'all'}-expenses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel report-panel">
      <div className="report-screen-head no-print">
        <div><h2>รายงานค่าใช้จ่าย</h2><p>เลือกเดือนและตัวกรอง แล้วปริ้นหรือบันทึกเป็น PDF ได้</p></div>
        <div className="report-actions">
          <button className="ghost" onClick={exportFilteredCsv}>Export CSV</button>
          <button onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <div className="report-filters no-print">
        <label>เดือน
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label>Cost Code
          <select value={costCodeId} onChange={(e) => setCostCodeId(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
        <label>ผู้ขาย
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label>สถานะ
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="UNPAID">ยังไม่จ่าย</option>
            <option value="PARTIAL">จ่ายบางส่วน</option>
            <option value="PAID">จ่ายแล้ว</option>
          </select>
        </label>
        <label>รูปแบบ
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="DETAIL">รายละเอียดค่าใช้จ่าย</option>
            <option value="SUMMARY">สรุปตาม Cost Code</option>
          </select>
        </label>
        <button className="ghost report-clear" onClick={() => { setMonth(''); setCostCodeId(''); setVendorId(''); setPaymentStatus(''); }}>ล้างตัวกรอง</button>
      </div>

      <div className="report-print">
        <div className="print-title">
          <p className="eyebrow">Vela Construction Expense</p>
          <h2>{project?.name || 'Sea Mountain'}</h2>
          <h3>{view === 'DETAIL' ? 'รายงานรายละเอียดค่าใช้จ่าย' : 'สรุปค่าใช้จ่ายตาม Cost Code'}</h3>
          <p>ประจำเดือน {monthLabel}</p>
        </div>

        <div className="report-kpis">
          <div><span>จำนวนรายการ</span><strong>{filtered.length}</strong></div>
          <div><span>ต้นทุนรวม</span><strong>{money(totals.total)}</strong></div>
          <div><span>จ่ายแล้ว</span><strong>{money(totals.paid)}</strong></div>
          <div><span>ค้างจ่าย</span><strong>{money(totals.outstanding)}</strong></div>
        </div>

        {view === 'DETAIL' ? (
          <div className="table-wrap report-table-wrap">
            <table className="report-table detail-report">
              <thead><tr><th>วันที่</th><th>เลขรายการ</th><th>เลขที่เอกสาร</th><th>รายละเอียด</th><th>หมวดงาน</th><th>ผู้ขาย</th><th>ก่อน VAT</th><th>VAT</th><th>WHT</th><th>ยอดรวม</th><th>จ่ายแล้ว</th><th>ค้างจ่าย</th></tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan="12" className="empty">ไม่มีข้อมูลตามตัวกรอง</td></tr>}
                {filtered.map((e) => {
                  const code = costMap[e.cost_code_id];
                  const vendor = vendorMap[e.vendor_id];
                  const outstanding = Math.max(Number(e.total_amount || 0) - Number(e.withholding_tax || 0) - Number(e.net_paid || 0), 0);
                  return <tr key={e.id}>
                    <td>{thaiDate(e.expense_date)}</td><td className="mono">{e.expense_no}</td><td>{e.document_no || '-'}</td><td>{e.description}</td>
                    <td>{code ? `${code.code} ${code.name}` : '-'}</td><td>{vendor?.name || '-'}</td>
                    <td className="amount">{money(e.subtotal)}</td><td className="amount">{money(e.vat_amount)}</td>
                    <td className="amount">{money(e.withholding_tax)}</td><td className="amount">{money(e.total_amount)}</td>
                    <td className="amount">{money(e.net_paid)}</td><td className="amount">{money(outstanding)}</td>
                  </tr>;
                })}
              </tbody>
              {filtered.length > 0 && <tfoot><tr><th colSpan="6">รวม</th><th className="amount">{money(totals.subtotal)}</th><th className="amount">{money(totals.vat)}</th><th className="amount">{money(totals.wht)}</th><th className="amount">{money(totals.total)}</th><th className="amount">{money(totals.paid)}</th><th className="amount">{money(totals.outstanding)}</th></tr></tfoot>}
            </table>
          </div>
        ) : (
          <div className="table-wrap report-table-wrap">
            <table className="report-table">
              <thead><tr><th>Cost Code</th><th>หมวดงาน</th><th>รายการ</th><th>ก่อน VAT</th><th>VAT</th><th>WHT</th><th>ต้นทุนรวม</th><th>จ่ายแล้ว</th><th>ค้างจ่าย</th></tr></thead>
              <tbody>
                {grouped.length === 0 && <tr><td colSpan="9" className="empty">ไม่มีข้อมูลตามตัวกรอง</td></tr>}
                {grouped.map((r) => <tr key={r.id}><td className="mono">{r.code}</td><td>{r.name}</td><td>{r.count}</td><td className="amount">{money(r.subtotal)}</td><td className="amount">{money(r.vat)}</td><td className="amount">{money(r.wht)}</td><td className="amount">{money(r.total)}</td><td className="amount">{money(r.paid)}</td><td className="amount">{money(r.outstanding)}</td></tr>)}
              </tbody>
              {grouped.length > 0 && <tfoot><tr><th colSpan="3">รวม</th><th className="amount">{money(totals.subtotal)}</th><th className="amount">{money(totals.vat)}</th><th className="amount">{money(totals.wht)}</th><th className="amount">{money(totals.total)}</th><th className="amount">{money(totals.paid)}</th><th className="amount">{money(totals.outstanding)}</th></tr></tfoot>}
            </table>
          </div>
        )}

        <div className="signature-block">
          <div><span>ผู้จัดทำ</span><b>................................................</b><small>วันที่ ........../........../..........</small></div>
          <div><span>ผู้ตรวจสอบ</span><b>................................................</b><small>วันที่ ........../........../..........</small></div>
          <div><span>ผู้อนุมัติ</span><b>................................................</b><small>วันที่ ........../........../..........</small></div>
        </div>
        <div className="print-footer"><span>Sea Mountain — Vela Construction Expense</span><span>พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</span></div>
      </div>
    </section>
  );
}

function AuditPanel() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/audit-logs?limit=100').then(setLogs).catch((err) => setError(err.message));
  }, []);

  return (
    <section className="panel">
      <div className="section-head"><div><h2>Audit Log</h2><p>ประวัติการสร้าง แก้ไข ยกเลิก และผูกเอกสาร</p></div></div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>เวลา</th><th>ประเภท</th><th>ID</th><th>Action</th><th>ผู้ดำเนินการ</th></tr></thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan="5" className="empty">ยังไม่มี Audit Log</td></tr>}
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString('th-TH')}</td>
                <td>{log.entity_type}</td>
                <td>{log.entity_id ?? '-'}</td>
                <td><span className="status">{log.action}</span></td>
                <td>{log.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [showExpense, setShowExpense] = useState(false);
  const [showVendor, setShowVendor] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [attachingExpense, setAttachingExpense] = useState(null);
  const [active, setActive] = useState('expenses');
  const [error, setError] = useState('');

  const project = projects[0];

  async function loadBase() {
    try {
      setError('');
      const [p, c, v] = await Promise.all([api('/projects'), api('/cost-codes'), api('/vendors')]);
      setProjects(p);
      setCostCodes(c);
      setVendors(v);
      if (p[0]) {
        const [e, s] = await Promise.all([api(`/expenses?project_id=${p[0].id}`), api(`/dashboard/${p[0].id}`)]);
        setExpenses(e);
        setSummary(s);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadBase(); }, []);

  async function voidExpense(expense) {
    const reason = window.prompt(`เหตุผลที่ยกเลิก ${expense.expense_no}`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/expenses/${expense.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await loadBase();
    } catch (err) {
      setError(err.message);
    }
  }

  const vendorMap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);
  const costMap = useMemo(() => Object.fromEntries(costCodes.map((c) => [c.id, `${c.code} ${c.name}`])), [costCodes]);

  const cards = [
    ['ต้นทุนตามเอกสาร', money(summary?.total_expenses)],
    ['จ่ายแล้ว', money(summary?.paid_amount)],
    ['ยอดรอจ่าย', money(summary?.outstanding_amount)],
    ['รายการค้าง', summary ? `${summary.unpaid_count} รายการ` : '—'],
  ];

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Vela Construction Expense</p>
          <h1>{project?.name || 'Sea Mountain'}</h1>
          <p>ระบบบันทึกค่าใช้จ่ายและเอกสารโครงการก่อสร้าง</p>
        </div>
        <button onClick={() => setShowExpense(true)}>+ บันทึกค่าใช้จ่าย</button>
      </header>

      {error && <div className="error banner">{error}</div>}

      <section className="grid">
        {cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </section>

      <nav className="tabs">
        <button className={active === 'expenses' ? 'active' : ''} onClick={() => setActive('expenses')}>ค่าใช้จ่าย</button>
        <button className={active === 'vendors' ? 'active' : ''} onClick={() => setActive('vendors')}>ผู้ขาย / ผู้รับเหมา</button>
        <button className={active === 'documents' ? 'active' : ''} onClick={() => setActive('documents')}>เอกสาร</button>
        <button className={active === 'codes' ? 'active' : ''} onClick={() => setActive('codes')}>Cost Codes</button>
        <button className={active === 'reports' ? 'active' : ''} onClick={() => setActive('reports')}>รายงาน</button>
        <button className={active === 'audit' ? 'active' : ''} onClick={() => setActive('audit')}>Audit Log</button>
      </nav>

      {active === 'expenses' && (
        <section className="panel">
          <div className="section-head">
            <div><h2>รายการค่าใช้จ่าย</h2><p>{expenses.length} รายการ</p></div>
            <button onClick={() => setShowExpense(true)}>+ เพิ่มรายการ</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>วันที่</th><th>เลขรายการ</th><th>รายละเอียด</th><th>หมวดงาน</th><th>ผู้ขาย</th><th>ยอด</th><th>เอกสาร</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
              <tbody>
                {expenses.length === 0 && <tr><td colSpan="9" className="empty">ยังไม่มีค่าใช้จ่าย — เพิ่มรายการแรกของ Sea Mountain ได้เลย</td></tr>}
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.expense_date}</td>
                    <td className="mono">{e.expense_no}</td>
                    <td>{e.description}</td>
                    <td>{costMap[e.cost_code_id] || '-'}</td>
                    <td>{vendorMap[e.vendor_id] || '-'}</td>
                    <td className="amount">{money(e.total_amount)}</td>
                    <td>{e.paperless_document_id ? <span className="status paid">DOC #{e.paperless_document_id}</span> : (e.document_task_id ? <span className="status partial">OCR</span> : '-')}</td>
                    <td><span className={`status ${e.payment_status.toLowerCase()}`}>{({UNPAID:'ยังไม่จ่าย',PARTIAL:'บางส่วน',PAID:'จ่ายแล้ว',VOID:'ยกเลิก'})[e.payment_status]}</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="mini ghost" disabled={e.payment_status === 'VOID'} onClick={() => setEditingExpense(e)}>แก้ไข</button>
                        <button className="mini ghost" disabled={e.payment_status === 'VOID'} onClick={() => setAttachingExpense(e)}>
                          {e.paperless_document_id ? 'เปลี่ยนเอกสาร' : 'แนบเอกสาร'}
                        </button>
                        <button className="mini danger" disabled={e.payment_status === 'VOID'} onClick={() => voidExpense(e)}>ยกเลิก</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {active === 'vendors' && (
        <section className="panel">
          <div className="section-head">
            <div><h2>ผู้ขาย / ผู้รับเหมา</h2><p>ใช้ข้อมูลเดียวกันทุกค่าใช้จ่าย ลดการพิมพ์ซ้ำ</p></div>
            <button onClick={() => setShowVendor(true)}>+ เพิ่มผู้ขาย</button>
          </div>
          <div className="vendor-grid">
            {vendors.length === 0 && <p className="empty">ยังไม่มีผู้ขาย</p>}
            {vendors.map((v) => (
              <div className="vendor-card" key={v.id}>
                <strong>{v.name}</strong>
                <span>{v.tax_id ? `Tax ID: ${v.tax_id}` : 'ไม่ระบุเลขภาษี'}</span>
                <span>{v.phone || ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {active === 'documents' && <DocumentPanel expenses={expenses} project={project} costCodes={costCodes} vendors={vendors} onUpdated={loadBase} />}

      {active === 'reports' && <ReportPanel project={project} expenses={expenses} costCodes={costCodes} vendors={vendors} />}
      {active === 'audit' && <AuditPanel />}

      {active === 'codes' && (
        <section className="panel">
          <div className="section-head"><div><h2>Cost Codes</h2><p>ฐานสำหรับดูต้นทุนแยกตามหมวดงาน</p></div></div>
          <div className="code-list">
            {costCodes.map((c) => <div key={c.id}><b>{c.code}</b><span>{c.name}</span></div>)}
          </div>
        </section>
      )}

      {showExpense && (
        <QuickExpenseModal
          projects={projects}
          costCodes={costCodes}
          vendors={vendors}
          onClose={() => setShowExpense(false)}
          onSaved={async () => { setShowExpense(false); await loadBase(); }}
        />
      )}

      {editingExpense && (
        <ExpenseModal
          projects={projects}
          costCodes={costCodes}
          vendors={vendors}
          existing={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSaved={async () => { setEditingExpense(null); await loadBase(); }}
        />
      )}
      {attachingExpense && (
        <AttachDocumentModal
          expense={attachingExpense}
          onClose={() => setAttachingExpense(null)}
          onSaved={loadBase}
        />
      )}

      {showVendor && (
        <VendorModal
          onClose={() => setShowVendor(false)}
          onSaved={async () => { setShowVendor(false); await loadBase(); }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
