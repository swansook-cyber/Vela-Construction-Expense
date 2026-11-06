import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
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


const thaiIntegerText = (value) => {
  const n = Math.floor(Math.abs(Number(value || 0)));
  if (n === 0) return 'ศูนย์';
  if (n >= 1000000) {
    const high = Math.floor(n / 1000000);
    const low = n % 1000000;
    return thaiIntegerText(high) + 'ล้าน' + (low ? thaiIntegerText(low) : '');
  }

  const digits = ['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const units = ['','สิบ','ร้อย','พัน','หมื่น','แสน'];
  const chars = String(n).split('').map(Number);
  let out = '';

  chars.forEach((digit, index) => {
    if (digit === 0) return;
    const pos = chars.length - index - 1;
    if (pos === 1) {
      if (digit === 1) out += 'สิบ';
      else if (digit === 2) out += 'ยี่สิบ';
      else out += digits[digit] + 'สิบ';
      return;
    }
    if (pos === 0 && digit === 1 && chars.length > 1) {
      out += 'เอ็ด';
      return;
    }
    out += digits[digit] + units[pos];
  });
  return out;
};

const thaiBahtText = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '';
  const negative = amount < 0 ? 'ลบ' : '';
  const satangTotal = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;
  const bahtText = thaiIntegerText(baht) + 'บาท';
  return negative + bahtText + (satang ? thaiIntegerText(satang) + 'สตางค์' : 'ถ้วน');
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
      const actualWht = form.payment_status === 'PAID' ? wht : 0;
      const netPaid = form.payment_status === 'PAID' ? Math.max(total - actualWht, 0) : 0;
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
          withholding_tax: actualWht.toFixed(2),
          default_wht_rate: Number(form.whtRate || 0).toFixed(2),
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
            <span>{form.payment_status==='PAID'?'หัก ณ ที่จ่าย':'WHT เมื่อจ่าย'} <b>-{money(wht)}</b></span>
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
  const existingWhtRate = existing?.default_wht_rate != null
    ? String(Number(existing.default_wht_rate))
    : (existingSubtotal > 0 ? String(Math.round(Number(existing?.withholding_tax || 0) / existingSubtotal * 100)) : '0');
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
  const paymentLocked = !!existing && Number(existing.net_paid || 0) > 0;

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
      let actualWht = paymentLocked ? Number(existing.withholding_tax || 0) : 0;
      let netPaid = paymentLocked ? Number(existing.net_paid || 0) : Number(form.paid_amount || 0);
      let paymentStatus = paymentLocked ? existing.payment_status : form.payment_status;
      let paymentMethod = paymentLocked ? existing.payment_method : form.payment_method;

      if (!paymentLocked) {
        if (paymentStatus === 'PAID') {
          actualWht = wht;
          netPaid = Math.max(total - actualWht, 0);
        } else if (paymentStatus === 'UNPAID') {
          actualWht = 0;
          netPaid = 0;
        }
      }

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
          withholding_tax: actualWht.toFixed(2),
          default_wht_rate: Number(form.whtRate || 0).toFixed(2),
          total_amount: total.toFixed(2),
          net_paid: netPaid.toFixed(2),
          payment_status: paymentStatus,
          payment_method: paymentMethod || null,
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
          {paymentLocked && <div className="info-message wide">รายการนี้มีประวัติการจ่ายแล้ว ยอดจ่าย/WHT/สถานะจะคำนวณจากใบสำคัญจ่าย ไม่แก้จากหน้านี้</div>}
          {!paymentLocked && form.payment_status === 'PARTIAL' && (
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

function VendorModal({ existing, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: existing?.name || '',
    cheque_payee_name: existing?.cheque_payee_name || '',
    entity_type: existing?.entity_type || 'UNKNOWN',
    tax_id: existing?.tax_id || '',
    phone: existing?.phone || '',
    address: existing?.address || '',
    notes: existing?.notes || ''
  });
  const [error, setError] = useState('');
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api(existing ? `/vendors/${existing.id}` : '/vendors', {
        method: existing ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...form,
          cheque_payee_name: form.cheque_payee_name?.trim() || null,
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
          <div><p className="eyebrow">Vendor</p><h2>{existing ? 'แก้ไขผู้ขาย / ผู้รับเหมา' : 'เพิ่มผู้ขาย / ผู้รับเหมา'}</h2></div>
          <button className="ghost icon" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="form-grid">
          <label className="wide">ชื่อ
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
          </label>
          <label className="wide">ชื่อจ่ายเช็ค
            <input value={form.cheque_payee_name} onChange={(e) => set('cheque_payee_name', e.target.value)} placeholder="ถ้าไม่กรอก จะใช้ชื่อผู้ขาย/ผู้รับเหมา" />
          </label>
          <label>ประเภทผู้รับเงิน
            <select value={form.entity_type} onChange={(e) => set('entity_type', e.target.value)}>
              <option value="UNKNOWN">ยังไม่ระบุ</option>
              <option value="INDIVIDUAL">บุคคลธรรมดา</option>
              <option value="JURISTIC">นิติบุคคล</option>
            </select>
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
            <button type="submit">{existing ? 'บันทึกการแก้ไข' : 'บันทึกผู้ขาย'}</button>
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
  const [month, setMonth] = useState('');
  const [costCodeId, setCostCodeId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [view, setView] = useState('DETAIL');
  const [reportType, setReportType] = useState('EXPENSE');
  const [vouchers, setVouchers] = useState([]);

  useEffect(() => {
    if (!project?.id) return;
    api(`/payment-vouchers?project_id=${project.id}`).then(setVouchers).catch(() => setVouchers([]));
  }, [project?.id]);

  const costMap = useMemo(() => Object.fromEntries(costCodes.map((c) => [c.id, c])), [costCodes]);
  const vendorMap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const voucherByExpense = useMemo(() => {
    const pairs = [];
    vouchers.forEach((v) => {
      const ids = v.expense_ids?.length ? v.expense_ids : (v.expense_id ? [v.expense_id] : []);
      ids.forEach((id) => pairs.push([id, v]));
    });
    return Object.fromEntries(pairs);
  }, [vouchers]);

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

  const availableMonths = useMemo(() => {
    return [...new Set(
      expenses
        .filter((e) => e.payment_status !== 'VOID' && e.expense_date)
        .map((e) => String(e.expense_date).slice(0, 7))
    )].sort().reverse();
  }, [expenses]);

  const monthLabel = useMemo(() => {
    if (!month) return 'ค่าใช้จ่ายทั้งหมด';
    const parts = month.split('-').map(Number);
    return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(parts[0], parts[1] - 1, 1));
  }, [month]);

  const whtRows = useMemo(() => vouchers.filter((v) => {
    if (Number(v.withholding_tax || 0) <= 0) return false;
    if (month && !String(v.voucher_date || '').startsWith(month)) return false;
    const vendor = vendorMap[v.vendor_id];
    if (reportType === 'WHT3' && vendor?.entity_type !== 'INDIVIDUAL') return false;
    if (reportType === 'WHT53' && vendor?.entity_type !== 'JURISTIC') return false;
    return reportType === 'WHT3' || reportType === 'WHT53';
  }).map((v) => {
    const ids = v.expense_ids?.length ? v.expense_ids : (v.expense_id ? [v.expense_id] : []);
    const voucherExpenses = ids.map((id) => expenses.find((x) => x.id === id)).filter(Boolean);
    const e = voucherExpenses[0];
    const vendor = vendorMap[v.vendor_id];
    const allocationByExpense = Object.fromEntries((v.allocations||[]).map((a)=>[a.expense_id,a]));
    const base = voucherExpenses.length
      ? voucherExpenses.reduce((sum,x)=>{
          const allocation=allocationByExpense[x.id];
          const gross=Number(allocation?.gross_amount ?? x.total_amount ?? 0);
          const total=Number(x.total_amount||0);
          const subtotal=Number(x.subtotal||0);
          return sum + (total ? gross*subtotal/total : gross);
        },0)
      : Number(v.gross_amount || 0);
    const tax = Number(v.withholding_tax || 0);
    const rate = v.wht_rate != null ? Number(v.wht_rate) : (base ? tax / base * 100 : 0);
    return { voucher:v, expense:e, expenses:voucherExpenses, vendor, base, tax, rate };
  }), [vouchers, expenses, vendorMap, month, reportType]);

  const vatRows = useMemo(() => expenses.filter((e) => {
    if (e.payment_status === 'VOID') return false;
    if (Number(e.vat_amount || 0) <= 0) return false;
    if (month && !String(e.expense_date || '').startsWith(month)) return false;
    return true;
  }).map((e) => ({ expense:e, vendor:vendorMap[e.vendor_id] })), [expenses, vendorMap, month]);

  const whtTotals = useMemo(() => whtRows.reduce((acc, r) => {
    acc.base += r.base; acc.tax += r.tax; return acc;
  }, { base:0, tax:0 }), [whtRows]);

  const vatTotals = useMemo(() => vatRows.reduce((acc, r) => {
    acc.subtotal += Number(r.expense.subtotal || 0);
    acc.vat += Number(r.expense.vat_amount || 0);
    acc.total += Number(r.expense.total_amount || 0);
    return acc;
  }, { subtotal:0, vat:0, total:0 }), [vatRows]);

  const reportTitle = reportType === 'WHT3' ? 'สรุปภาษีหัก ณ ที่จ่าย — ภ.ง.ด.3'
    : reportType === 'WHT53' ? 'สรุปภาษีหัก ณ ที่จ่าย — ภ.ง.ด.53'
    : reportType === 'VAT' ? 'รายงานภาษีซื้อ VAT'
    : 'รายงานค่าใช้จ่าย';

  function exportTaxXlsx() {
    let header = [];
    let rows = [];
    let sheetName = 'Tax Report';

    if (reportType === 'WHT3' || reportType === 'WHT53') {
      header = ['วันที่จ่าย','เลขที่ 50 ทวิ','ผู้รับเงิน','เลขประจำตัวผู้เสียภาษี','ประเภทเงินได้','ฐานภาษี','อัตรา WHT (%)','ภาษีหัก ณ ที่จ่าย','เลขที่ใบสำคัญจ่าย','เลขที่เอกสาร'];
      rows = whtRows.map((r) => [
        thaiDate(r.voucher.voucher_date),
        String(r.voucher.wht_certificate_no || '').trim(),
        String(r.vendor?.name || r.voucher.payee_name || '').trim(),
        String(r.vendor?.tax_id || '').trim(),
        String(r.voucher.income_type || r.expenses?.map((e)=>e.description).join(' / ') || r.expense?.description || '').trim(),
        r.base,
        r.rate,
        r.tax,
        String(r.voucher.voucher_no || '').trim(),
        String(r.expenses?.map((e)=>e.document_no || e.expense_no).filter(Boolean).join(', ') || r.expense?.document_no || '').trim()
      ]);
      sheetName = reportType === 'WHT3' ? 'PND3 Summary' : 'PND53 Summary';
    } else if (reportType === 'VAT') {
      header = ['วันที่เอกสาร','เลขที่เอกสาร/ใบกำกับภาษี','ผู้ขาย','เลขประจำตัวผู้เสียภาษี','รายละเอียด','มูลค่าก่อน VAT','VAT','ยอดรวม'];
      rows = vatRows.map((r) => [
        thaiDate(r.expense.expense_date),
        String(r.expense.document_no || '').trim(),
        String(r.vendor?.name || '').trim(),
        String(r.vendor?.tax_id || '').trim(),
        String(r.expense.description || '').trim(),
        Number(r.expense.subtotal || 0),
        Number(r.expense.vat_amount || 0),
        Number(r.expense.total_amount || 0)
      ]);
      sheetName = 'VAT Purchase';
    } else {
      exportAccountingXlsx();
      return;
    }

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!freeze'] = { xSplit:0, ySplit:1 };
    ws['!autofilter'] = { ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(rows.length,1),c:header.length-1}}) };
    ws['!cols'] = header.map((h) => ({wch:Math.max(14, Math.min(34, h.length + 8))}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${project?.code || 'SEA-MOUNTAIN'}-${month || 'all'}-${reportType.toLowerCase()}.xlsx`);
  }

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

  function exportAccountingCsv() {
    const header = [
      'วันที่','เลขรายการ','เลขที่เอกสาร','รายละเอียด','Cost Code',
      'ผู้ขาย/ผู้รับเหมา','เลขประจำตัวผู้เสียภาษี','ประเภทผู้รับเงิน',
      'ก่อน VAT','VAT','ยอดเอกสาร','WHT','จ่ายสุทธิ','สถานะ',
      'วิธีจ่าย','เลขที่ใบสำคัญจ่าย','เลขที่ 50 ทวิ','ธนาคาร','เลขที่เช็ค','วันที่เช็ค','หมายเหตุ'
    ];
    const rows = filtered.map((e) => {
      const code = costMap[e.cost_code_id];
      const vendor = vendorMap[e.vendor_id];
      const voucher = voucherByExpense[e.id];
      return [
        thaiDate(e.expense_date),
        e.expense_no,
        e.document_no || '',
        e.description,
        code ? `${code.code} ${code.name}` : '',
        vendor?.name || '',
        vendor?.tax_id || '',
        vendor?.entity_type === 'INDIVIDUAL' ? 'บุคคลธรรมดา' : vendor?.entity_type === 'JURISTIC' ? 'นิติบุคคล' : '',
        e.subtotal,
        e.vat_amount,
        e.total_amount,
        e.withholding_tax,
        voucher?.net_amount ?? e.net_paid ?? '',
        e.payment_status,
        voucher?.payment_method || e.payment_method || '',
        voucher?.voucher_no || '',
        voucher?.wht_certificate_no || '',
        voucher?.bank_name || '',
        voucher?.cheque_no || '',
        voucher?.cheque_date ? thaiDate(voucher.cheque_date) : '',
        voucher?.notes || e.notes || ''
      ];
    });
    const esc = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const csv = '\ufeff' + [header, ...rows].map((row) => row.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.code || 'sea-mountain'}-${month || 'all'}-accounting.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAccountingXlsx() {
    const header = [
      'วันที่','เลขรายการ','เลขที่เอกสาร','รายละเอียด','Cost Code',
      'ผู้ขาย/ผู้รับเหมา','เลขประจำตัวผู้เสียภาษี','ประเภทผู้รับเงิน',
      'ก่อน VAT','VAT','ยอดเอกสาร','WHT','จ่ายสุทธิ','สถานะ',
      'วิธีจ่าย','เลขที่ใบสำคัญจ่าย','เลขที่ 50 ทวิ','ธนาคาร','เลขที่เช็ค','วันที่เช็ค','หมายเหตุ'
    ];
    const rows = filtered.map((e) => {
      const code = costMap[e.cost_code_id];
      const vendor = vendorMap[e.vendor_id];
      const voucher = voucherByExpense[e.id];
      const clean = (v) => String(v ?? '').trim();
      return [
        thaiDate(e.expense_date),
        clean(e.expense_no),
        clean(e.document_no),
        clean(e.description),
        code ? clean(`${code.code} ${code.name}`) : '',
        clean(vendor?.name),
        clean(vendor?.tax_id),
        vendor?.entity_type === 'INDIVIDUAL' ? 'บุคคลธรรมดา' : vendor?.entity_type === 'JURISTIC' ? 'นิติบุคคล' : '',
        Number(e.subtotal || 0),
        Number(e.vat_amount || 0),
        Number(e.total_amount || 0),
        Number(e.withholding_tax || 0),
        Number(voucher?.net_amount ?? e.net_paid ?? 0),
        clean(e.payment_status),
        clean(voucher?.payment_method || e.payment_method),
        clean(voucher?.voucher_no),
        clean(voucher?.wht_certificate_no),
        clean(voucher?.bank_name),
        clean(voucher?.cheque_no),
        voucher?.cheque_date ? thaiDate(voucher.cheque_date) : '',
        clean(voucher?.notes || e.notes)
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(rows.length,1),c:header.length-1}}) };
    ws['!cols'] = [
      {wch:12},{wch:16},{wch:16},{wch:34},{wch:24},{wch:28},{wch:18},{wch:16},
      {wch:14},{wch:12},{wch:14},{wch:12},{wch:14},{wch:12},{wch:14},{wch:18},
      {wch:18},{wch:20},{wch:16},{wch:14},{wch:30}
    ];

    // Force identifier-like columns to text so Excel preserves leading zeros.
    const textCols = [1,2,6,15,16,18];
    for (let r = 1; r <= rows.length; r++) {
      for (const c of textCols) {
        const cell = ws[XLSX.utils.encode_cell({r,c})];
        if (cell) {
          cell.t = 's';
          cell.v = String(cell.v ?? '');
          delete cell.w;
        }
      }
      for (const c of [8,9,10,11,12]) {
        const cell = ws[XLSX.utils.encode_cell({r,c})];
        if (cell) cell.z = '#,##0.00';
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Accounting');
    const filename = `${project?.code || 'SEA-MOUNTAIN'}-${month || 'all'}-accounting.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  return (
    <section className="panel report-panel">
      <div className="report-screen-head no-print">
        <div><h2>{reportTitle}</h2><p>{reportType === 'EXPENSE' ? 'กรองข้อมูล ตรวจยอด และส่งต่อสำนักงานบัญชี' : 'สรุปรายเดือนสำหรับตรวจสอบและส่งสำนักงานบัญชี'}</p></div>
        <div className="report-actions">
          <button className="report-primary" onClick={reportType === 'EXPENSE' ? exportAccountingXlsx : exportTaxXlsx}>{reportType === 'EXPENSE' ? 'Excel สำหรับสำนักงานบัญชี' : 'ส่งออก Excel'}</button>
          <button className="ghost" onClick={() => window.print()}>พิมพ์ / PDF</button>
          <details className="export-menu"><summary>ส่งออกอื่น ๆ</summary><div className="export-menu-popover"><button onClick={exportFilteredCsv}>รายงาน CSV</button><button onClick={exportAccountingCsv}>สำนักงานบัญชี CSV</button></div></details>
        </div>
      </div>

      <div className="report-filters no-print">
        <label>ประเภทรายงาน
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="EXPENSE">ค่าใช้จ่ายทั่วไป</option>
            <option value="WHT3">WHT — ภ.ง.ด.3</option>
            <option value="WHT53">WHT — ภ.ง.ด.53</option>
            <option value="VAT">ภาษีซื้อ VAT</option>
          </select>
        </label>
        <label>ช่วงเวลา
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">ทั้งหมด — ไม่ระบุเดือน</option>
            {availableMonths.map((m) => {
              const [y, mo] = m.split('-').map(Number);
              const label = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1));
              return <option key={m} value={m}>{label}</option>;
            })}
          </select>
        </label>
        {reportType === 'EXPENSE' && <>
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
        </>}
        <button className="ghost report-clear" onClick={() => { setMonth(''); setCostCodeId(''); setVendorId(''); setPaymentStatus(''); }}>ล้างตัวกรอง</button>
      </div>

      <div className="report-print">
        <div className="print-title">
          <h2>{project?.name || 'Sea Mountain'}</h2>
          <h3>{reportTitle}</h3>
          <p>{month ? `ประจำเดือน ${monthLabel}` : monthLabel}</p>
        </div>

        {reportType === 'EXPENSE' ? (view === 'DETAIL' ? (
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
        )) : reportType === 'VAT' ? (
          <div className="table-wrap report-table-wrap">
            <table className="report-table">
              <thead><tr><th>วันที่เอกสาร</th><th>เลขที่เอกสาร/ใบกำกับภาษี</th><th>ผู้ขาย</th><th>Tax ID</th><th>รายละเอียด</th><th>ก่อน VAT</th><th>VAT</th><th>ยอดรวม</th></tr></thead>
              <tbody>
                {vatRows.length === 0 && <tr><td colSpan="8" className="empty">ไม่มีรายการ VAT ตามช่วงเวลาที่เลือก</td></tr>}
                {vatRows.map(({expense:e,vendor}) => <tr key={e.id}><td>{thaiDate(e.expense_date)}</td><td>{e.document_no || '-'}</td><td>{vendor?.name || '-'}</td><td className="mono">{vendor?.tax_id || '-'}</td><td>{e.description}</td><td className="amount">{money(e.subtotal)}</td><td className="amount">{money(e.vat_amount)}</td><td className="amount">{money(e.total_amount)}</td></tr>)}
              </tbody>
              {vatRows.length > 0 && <tfoot><tr><th colSpan="5">รวม</th><th className="amount">{money(vatTotals.subtotal)}</th><th className="amount">{money(vatTotals.vat)}</th><th className="amount">{money(vatTotals.total)}</th></tr></tfoot>}
            </table>
            <p className="tax-report-note">รายงานนี้เป็นสรุปภายในจากรายการที่บันทึก VAT ในระบบ กรุณาตรวจสอบใบกำกับภาษีต้นฉบับก่อนใช้ยื่นภาษี</p>
          </div>
        ) : (
          <div className="table-wrap report-table-wrap">
            <table className="report-table">
              <thead><tr><th>วันที่จ่าย</th><th>เลขที่ 50 ทวิ</th><th>ผู้รับเงิน</th><th>Tax ID</th><th>ประเภทเงินได้</th><th>ฐานภาษี</th><th>อัตรา</th><th>WHT</th><th>PV</th></tr></thead>
              <tbody>
                {whtRows.length === 0 && <tr><td colSpan="9" className="empty">ไม่มีรายการหัก ณ ที่จ่ายตามช่วงเวลาที่เลือก</td></tr>}
                {whtRows.map((r) => <tr key={r.voucher.id}><td>{thaiDate(r.voucher.voucher_date)}</td><td>{r.voucher.wht_certificate_no || '-'}</td><td>{r.vendor?.name || r.voucher.payee_name}</td><td className="mono">{r.vendor?.tax_id || '-'}</td><td>{r.voucher.income_type || r.expense?.description || '-'}</td><td className="amount">{money(r.base)}</td><td className="amount">{r.rate.toFixed(2)}%</td><td className="amount">{money(r.tax)}</td><td>{r.voucher.voucher_no}</td></tr>)}
              </tbody>
              {whtRows.length > 0 && <tfoot><tr><th colSpan="5">รวม</th><th className="amount">{money(whtTotals.base)}</th><th></th><th className="amount">{money(whtTotals.tax)}</th><th></th></tr></tfoot>}
            </table>
            <p className="tax-report-note">รายงานนี้เป็นสรุปภายในสำหรับตรวจสอบ/ส่งสำนักงานบัญชี ไม่ใช่แบบยื่น ภ.ง.ด. อย่างเป็นทางการ</p>
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


function printDocument(title, html) {
  const win = window.open('', '_blank', 'width=1100,height=900');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    @page{size:A4;margin:14mm}
    body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#111;margin:0;background:#eef1f3}
    h1,h2,h3,p{margin:0}.head{text-align:center;margin-bottom:22px}.head h2{font-size:24px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin:18px 0}
    .line{display:flex;justify-content:space-between;border-bottom:1px solid #bbb;padding:8px 0}
    .amount{font-size:22px;font-weight:700}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;margin-top:55px;text-align:center}
    .sign div{padding-top:35px;border-top:1px dotted #333}.cheque{width:190mm;height:82mm;border:1px dashed #999;padding:12mm;position:relative}
    .cheque .date{text-align:right}.cheque .payee{font-size:20px;margin-top:18px}.cheque .num{position:absolute;right:12mm;top:42mm;font-size:22px;font-weight:700}
    .note{font-size:11px;color:#666;margin-top:8px}
    .preview-toolbar{position:sticky;top:0;z-index:99;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;background:#17212b;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15)}
    .preview-toolbar strong{font-size:14px}.preview-actions{display:flex;gap:8px}
    .preview-actions button{border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}
    .preview-actions .print{background:#fff;color:#17212b}.preview-actions .close{background:#3b4650;color:#fff}
    .preview-sheet{width:210mm;min-height:297mm;margin:18px auto;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.16)}
    @media print{
      body{background:#fff}
      .preview-toolbar{display:none!important}
      .preview-sheet{width:auto;min-height:0;margin:0;box-shadow:none}
      button{display:none}
    }
  </style></head><body>
    <div class="preview-toolbar"><strong>ตัวอย่างก่อนพิมพ์ — ${title}</strong><div class="preview-actions"><button class="print" onclick="window.print()">พิมพ์</button><button class="close" onclick="window.close()">ปิด</button></div></div>
    <div class="preview-sheet">${html}</div>
  </body></html>`);
  win.document.close();
}

function PaymentVoucherModal({ project, expenses, vendors, vouchers, onClose, onSaved }) {
  const allocationsByExpense = useMemo(() => {
    const rows = {};
    vouchers.forEach((v) => {
      const allocations = v.allocations?.length
        ? v.allocations
        : (v.expense_id ? [{ expense_id:v.expense_id, gross_amount:v.gross_amount, withholding_tax:v.withholding_tax, net_amount:v.net_amount }] : []);
      allocations.forEach((a) => {
        if (!rows[a.expense_id]) rows[a.expense_id] = [];
        rows[a.expense_id].push(a);
      });
    });
    return rows;
  }, [vouchers]);

  const expenseMeta = useMemo(() => Object.fromEntries(expenses.map((e) => {
    const prior = allocationsByExpense[e.id] || [];
    const allocatedGross = prior.reduce((sum,a)=>sum + Number(a.gross_amount||0),0);
    const allocatedWht = prior.reduce((sum,a)=>sum + Number(a.withholding_tax||0),0);
    const total = Number(e.total_amount||0);
    const subtotal = Number(e.subtotal||0);
    const manualGross = prior.length ? 0 : Math.min(total, Number(e.net_paid||0) + Number(e.withholding_tax||0));
    const paidGross = Math.max(allocatedGross, manualGross);
    const paidWht = prior.length ? allocatedWht : Number(e.withholding_tax||0);
    const remaining = Math.max(total-paidGross,0);
    const priorTaxBase = prior.reduce((sum,a)=>sum + (total ? Number(a.gross_amount||0) * subtotal / total : Number(a.gross_amount||0)),0);
    const inferredRate = priorTaxBase > 0
      ? paidWht / priorTaxBase * 100
      : (e.default_wht_rate != null ? Number(e.default_wht_rate) : (subtotal > 0 && Number(e.withholding_tax||0) > 0 ? Number(e.withholding_tax||0) / subtotal * 100 : 0));
    return [e.id,{paidGross,paidWht,remaining,inferredRate}];
  })), [expenses,allocationsByExpense]);

  const eligible = expenses.filter((e) => e.payment_status !== 'VOID' && (expenseMeta[e.id]?.remaining||0) > 0.009);
  const vendorIds = [...new Set(eligible.map((e) => e.vendor_id).filter(Boolean))];
  const [vendorId, setVendorId] = useState(vendorIds[0] || '');
  const vendor = vendors.find((v) => String(v.id) === String(vendorId));
  const vendorExpenses = eligible.filter((e) => String(e.vendor_id || '') === String(vendorId || ''));

  const makeDraft = (e) => ({
    selected:true,
    amount:Number((expenseMeta[e.id]?.remaining||0).toFixed(2)),
    whtRate:[0,1,3,5].reduce((best,r)=>Math.abs(r-(expenseMeta[e.id]?.inferredRate||0))<Math.abs(best-(expenseMeta[e.id]?.inferredRate||0))?r:best,0)
  });

  const [drafts,setDrafts]=useState(() => vendorExpenses[0] ? {[vendorExpenses[0].id]:makeDraft(vendorExpenses[0])} : {});
  const [form, setForm] = useState({
    voucher_date: today(),
    payment_method: 'TRANSFER',
    payee_name: vendor?.name || '',
    cheque_no: '',
    cheque_date: today(),
    bank_name: 'ธนาคารไทยพาณิชย์',
    notes: '',
  });
  const [error, setError] = useState('');
  const set = (k,v) => setForm((x) => ({...x,[k]:v}));

  useEffect(() => {
    const first = vendorExpenses[0];
    setDrafts(first ? {[first.id]:makeDraft(first)} : {});
    setForm((old) => ({
      ...old,
      payee_name: vendor?.name || '',
      payment_method: first?.payment_method || old.payment_method || 'TRANSFER',
    }));
  }, [vendorId]);

  const selectedExpenses = vendorExpenses.filter((e)=>drafts[e.id]?.selected);
  const allocations = selectedExpenses.map((e)=>{
    const draft=drafts[e.id];
    const amount=Math.max(0,Math.min(Number(draft?.amount||0),expenseMeta[e.id]?.remaining||0));
    const total=Number(e.total_amount||0);
    const subtotal=Number(e.subtotal||0);
    const taxBase=total ? amount*subtotal/total : amount;
    const wht=taxBase*Number(draft?.whtRate||0)/100;
    return {expense:e,gross:amount,wht,net:Math.max(amount-wht,0),taxBase};
  }).filter((x)=>x.gross>0);

  const gross = allocations.reduce((sum,x)=>sum+x.gross,0);
  const wht = allocations.reduce((sum,x)=>sum+x.wht,0);
  const net = allocations.reduce((sum,x)=>sum+x.net,0);

  function toggleExpense(e) {
    setDrafts((rows)=>{
      const current=rows[e.id];
      if(current) return {...rows,[e.id]:{...current,selected:!current.selected}};
      return {...rows,[e.id]:makeDraft(e)};
    });
  }
  function updateDraft(id,key,value){
    setDrafts((rows)=>({...rows,[id]:{...(rows[id]||{selected:true}),[key]:value}}));
  }

  async function submit(e) {
    e.preventDefault();
    if (!project || !vendor || allocations.length === 0) return;
    setError('');
    try {
      await api('/payment-vouchers', {
        method:'POST',
        body: JSON.stringify({
          project_id: project.id,
          expense_id: allocations[0].expense.id,
          expense_ids: allocations.map((x)=>x.expense.id),
          allocations: allocations.map((x)=>({
            expense_id:x.expense.id,
            gross_amount:x.gross.toFixed(2),
            withholding_tax:x.wht.toFixed(2),
          })),
          vendor_id: vendor.id,
          voucher_date: form.voucher_date,
          gross_amount: gross.toFixed(2),
          withholding_tax: wht.toFixed(2),
          wht_rate: null,
          income_type: null,
          net_amount: net.toFixed(2),
          payment_method: form.payment_method || null,
          payee_name: form.payee_name,
          cheque_no: form.payment_method === 'CHEQUE' ? (form.cheque_no || null) : null,
          cheque_date: form.payment_method === 'CHEQUE' ? form.cheque_date : null,
          bank_name: form.payment_method === 'CHEQUE' ? (form.bank_name || null) : null,
          notes: form.notes || null,
        })
      });
      await onSaved();
    } catch(err) { setError(err.message); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" onMouseDown={(e)=>e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Payment Voucher</p><h2>ออกใบสำคัญจ่าย</h2><p>รวมหลายบิล และแบ่งจ่ายเป็นงวดได้</p></div><button className="ghost icon" onClick={onClose}>×</button></div>
      <form className="form-grid" onSubmit={submit}>
        <label className="wide">ผู้ขาย / ผู้รับเหมา
          <select value={vendorId} onChange={(e)=>setVendorId(e.target.value)} required>
            {vendorIds.length===0 && <option value="">ไม่มีบิลที่มียอดคงเหลือ</option>}
            {vendorIds.map((id)=>{const v=vendors.find((x)=>x.id===id);return <option key={id} value={id}>{v?.name||'-'}</option>})}
          </select>
        </label>

        <div className="wide voucher-bill-picker">
          <div className="voucher-bill-head"><b>เลือกบิล / กำหนดยอดงวด</b><span>{allocations.length} รายการ</span></div>
          {vendorExpenses.length===0 && <div className="empty">ไม่มีบิลของผู้ขายรายนี้ที่มียอดคงเหลือ</div>}
          {vendorExpenses.map((e)=>{
            const meta=expenseMeta[e.id];
            const draft=drafts[e.id]||{};
            return <div key={e.id} className="voucher-installment-row">
              <label className="voucher-select">
                <input type="checkbox" checked={!!draft.selected} onChange={()=>toggleExpense(e)} />
                <span className="voucher-bill-main"><b>{e.document_no||e.expense_no}</b><small>{thaiDate(e.expense_date)} · {e.description}</small></span>
              </label>
              <div className="voucher-balance"><span>ยอดเต็ม</span><b>{money(e.total_amount)}</b><span>จ่ายสะสม</span><b>{money(meta.paidGross)}</b><span>คงเหลือ</span><b>{money(meta.remaining)}</b></div>
              {draft.selected&&<div className="voucher-installment-inputs">
                <label>จ่ายงวดนี้
                  <input type="number" min="0.01" max={meta.remaining} step="0.01" value={draft.amount??''} onChange={(ev)=>updateDraft(e.id,'amount',ev.target.value)} required />
                </label>
                <label>WHT
                  <select value={draft.whtRate??0} onChange={(ev)=>updateDraft(e.id,'whtRate',Number(ev.target.value))}>
                    <option value="0">ไม่หัก</option><option value="1">1%</option><option value="3">3%</option><option value="5">5%</option>
                  </select>
                </label>
              </div>}
            </div>
          })}
        </div>

        <label>วันที่ใบสำคัญจ่าย<input type="date" value={form.voucher_date} onChange={(e)=>set('voucher_date',e.target.value)} required /></label>
        <label>ผู้รับเงิน<input value={form.payee_name} onChange={(e)=>set('payee_name',e.target.value)} required /></label>
        <label>วิธีจ่าย
          <select value={form.payment_method} onChange={(e)=>set('payment_method',e.target.value)}>
            <option value="TRANSFER">โอน</option><option value="CASH">เงินสด</option><option value="CHEQUE">เช็ค</option>
          </select>
        </label>
        {form.payment_method==='CHEQUE' && <>
          <label>ธนาคาร
            <select value={form.bank_name} onChange={(e)=>set('bank_name',e.target.value)} required>
              <option value="ธนาคารไทยพาณิชย์">ไทยพาณิชย์</option>
              <option value="ธนาคารกรุงศรีอยุธยา">กรุงศรี</option>
            </select>
          </label>
          <label>เลขที่เช็ค<input value={form.cheque_no} onChange={(e)=>set('cheque_no',e.target.value)} required /></label>
          <label>วันที่เช็ค<input type="date" value={form.cheque_date} onChange={(e)=>set('cheque_date',e.target.value)} required /></label>
        </>}
        <div className="calc wide">
          <span>รวมงวด <b>{allocations.length} รายการ</b></span>
          <span>ยอดงวดนี้ <b>{money(gross)}</b></span>
          <span>หัก ณ ที่จ่าย <b>-{money(wht)}</b></span>
          <span className="total-line">ยอดเช็ค / จ่ายสุทธิ <b>{money(net)}</b></span>
        </div>
        <label className="wide">หมายเหตุ / เลขใบวางบิล<textarea rows="2" value={form.notes} onChange={(e)=>set('notes',e.target.value)} placeholder="เช่น งวดที่ 1 / ใบวางบิลเลขที่ ..." /></label>
        {error && <div className="error wide">{error}</div>}
        <div className="actions wide"><button type="button" className="ghost" onClick={onClose}>ยกเลิก</button><button disabled={!vendor || allocations.length===0}>ออกใบสำคัญจ่าย</button></div>
      </form>
    </div>
  </div>;
}


function PaymentEditModal({ voucher, onClose, onSaved }) {
  const [form,setForm]=useState({
    payment_method:voucher.payment_method||'TRANSFER',
    bank_name:voucher.bank_name||'ธนาคารไทยพาณิชย์',
    cheque_no:voucher.cheque_no||'',
    cheque_date:voucher.cheque_date||today(),
    notes:voucher.notes||''
  });
  const [error,setError]=useState('');
  const set=(k,v)=>setForm((x)=>({...x,[k]:v}));
  async function submit(e){
    e.preventDefault(); setError('');
    try{
      await api(`/payment-vouchers/${voucher.id}/payment`,{
        method:'PUT',
        body:JSON.stringify({
          payment_method:form.payment_method,
          bank_name:form.payment_method==='CHEQUE'?(form.bank_name||null):null,
          cheque_no:form.payment_method==='CHEQUE'?(form.cheque_no||null):null,
          cheque_date:form.payment_method==='CHEQUE'?form.cheque_date:null,
          notes:form.notes||null
        })
      });
      await onSaved();
    }catch(err){setError(err.message);}
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal small" onMouseDown={(e)=>e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Payment</p><h2>แก้ไขข้อมูลการจ่าย</h2><p>{voucher.voucher_no}</p></div><button className="ghost icon" onClick={onClose}>×</button></div>
      <form className="form-grid" onSubmit={submit}>
        <label>วิธีจ่าย<select value={form.payment_method} onChange={(e)=>set('payment_method',e.target.value)}>
          <option value="TRANSFER">โอน</option><option value="CASH">เงินสด</option><option value="CHEQUE">เช็ค</option>
        </select></label>
        {form.payment_method==='CHEQUE' && <>
          <label>ธนาคาร
            <select value={form.bank_name} onChange={(e)=>set('bank_name',e.target.value)} required>
              <option value="ธนาคารไทยพาณิชย์">ไทยพาณิชย์</option>
              <option value="ธนาคารกรุงศรีอยุธยา">กรุงศรี</option>
            </select>
          </label>
          <label>เลขที่เช็ค<input value={form.cheque_no} onChange={(e)=>set('cheque_no',e.target.value)} required /></label>
          <label>วันที่เช็ค<input type="date" value={form.cheque_date} onChange={(e)=>set('cheque_date',e.target.value)} required /></label>
        </>}
        <label className="wide">หมายเหตุ<textarea rows="2" value={form.notes} onChange={(e)=>set('notes',e.target.value)} /></label>
        {error&&<div className="error wide">{error}</div>}
        <div className="actions wide"><button type="button" className="ghost" onClick={onClose}>ยกเลิก</button><button>บันทึกการจ่าย</button></div>
      </form>
    </div>
  </div>;
}


function ChequePreviewModal({ voucher, onClose }) {
  const defaults = { width:178, height:89, payeeX:18, payeeY:30, dateX:134, dateY:12, amountX:134, amountY:42, amountTextX:18, amountTextY:46, amountTextFontSize:13, accountPayeeX:12, accountPayeeY:10 };
  const [cfg,setCfg]=useState(() => {
    try {
      const saved=JSON.parse(localStorage.getItem('vela-cheque-layout')||'{}');
      if (saved.width===190 && saved.height===82) {
        const migrated={...saved,width:178,height:89};
        if (saved.dateX===146) migrated.dateX=134;
        if (saved.amountX===146) migrated.amountX=134;
        localStorage.setItem('vela-cheque-layout',JSON.stringify(migrated));
        return {...defaults,...migrated};
      }
      return {...defaults,...saved};
    }
    catch { return defaults; }
  });
  const [showSettings,setShowSettings]=useState(false);
  const [accountPayee,setAccountPayee]=useState(true);
  const set=(k,v)=>setCfg((x)=>({...x,[k]:Number(v)}));
  const chequeDateValue=voucher.cheque_date||voucher.voucher_date;
  const date=thaiDate(chequeDateValue);
  const isScb=voucher.bank_name==='ธนาคารไทยพาณิชย์';
  const scbDateDigits=(() => {
    if (!chequeDateValue) return [];
    const [y,m,d]=String(chequeDateValue).slice(0,10).split('-').map(Number);
    if (!y||!m||!d) return [];
    return (`${String(d).padStart(2,'0')}${String(m).padStart(2,'0')}${String(y+543)}`).split('');
  })();
  const chequePayee=voucher.cheque_payee_name || voucher.payee_name;
  const amountText=thaiBahtText(voucher.net_amount);

  function save(){
    localStorage.setItem('vela-cheque-layout',JSON.stringify(cfg));
  }

  function openPrint(){
    save();
    const title=voucher.cheque_no||voucher.voucher_no;
    printDocument(title,`<style>
      @page{size:${cfg.width}mm ${cfg.height}mm;margin:0}
      body{margin:0;background:#fff}
      .cheque-print{position:relative;width:${cfg.width}mm;height:${cfg.height}mm;font-family:Arial,"Noto Sans Thai",sans-serif;color:#000}
      .c-payee,.c-date,.c-amount,.c-amount-text,.c-account-payee{position:absolute;white-space:nowrap}
      .c-payee{left:${cfg.payeeX}mm;top:${cfg.payeeY}mm;font-size:16px;font-weight:700}
      .c-amount-text{left:${cfg.amountTextX}mm;top:${cfg.amountTextY}mm;font-size:${cfg.amountTextFontSize}px;font-weight:700}
      .c-account-payee{left:${cfg.accountPayeeX}mm;top:${cfg.accountPayeeY}mm;font-size:11px;font-weight:800;letter-spacing:.08em;border-top:1.5px solid #000;border-bottom:1.5px solid #000;padding:1mm 5mm}
      .c-date{left:${cfg.dateX}mm;top:${cfg.dateY}mm;font-size:13px}
      .c-date-boxes{position:absolute;left:${cfg.dateX}mm;top:${cfg.dateY}mm;display:flex;gap:.7mm}
      .c-date-box{width:5mm;height:5mm;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-sizing:border-box}
      .c-date-gap{margin-left:1.1mm}
      .c-amount{left:${cfg.amountX}mm;top:${cfg.amountY}mm;font-size:16px;font-weight:700}
      @media print{.preview-toolbar{display:none!important}.preview-sheet{margin:0!important;box-shadow:none!important;width:auto!important;min-height:0!important}}
    </style>
    <div class="cheque-print">
      ${accountPayee ? '<div class="c-account-payee">A/C PAYEE ONLY</div>' : ''}
      <div class="c-payee">${chequePayee}</div>
      ${isScb ? `<div class="c-date-boxes">${scbDateDigits.map((digit,index)=>`<span class="c-date-box ${index===2||index===4?'c-date-gap':''}">${digit}</span>`).join('')}</div>` : `<div class="c-date">${date}</div>`}
      <div class="c-amount-text">${amountText}</div>
      <div class="c-amount">${money(voucher.net_amount)}</div>
    </div>`);
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal" onMouseDown={(e)=>e.stopPropagation()}>
      <div className="modal-head">
        <div><p className="eyebrow">Cheque Calibration</p><h2>ตัวอย่างพิมพ์เช็ค</h2><p>{voucher.bank_name||'-'} · {voucher.cheque_no||'-'}</p></div>
        <button className="ghost icon" onClick={onClose}>×</button>
      </div>

      <div style={{overflow:'auto',padding:'12px',background:'#eef1f3',borderRadius:'14px',marginBottom:'16px'}}>
        <div style={{position:'relative',width:`${cfg.width}mm`,height:`${cfg.height}mm`,background:'#fff',border:'1px dashed #999',margin:'0 auto'}}>
          {accountPayee&&<div style={{position:'absolute',left:`${cfg.accountPayeeX}mm`,top:`${cfg.accountPayeeY}mm`,fontWeight:800,fontSize:'11px',letterSpacing:'.08em',whiteSpace:'nowrap',borderTop:'1.5px solid #000',borderBottom:'1.5px solid #000',padding:'1mm 5mm'}}>A/C PAYEE ONLY</div>}
          <div style={{position:'absolute',left:`${cfg.payeeX}mm`,top:`${cfg.payeeY}mm`,fontWeight:700,fontSize:'16px',whiteSpace:'nowrap'}}>{chequePayee}</div>
          {isScb ? <div style={{position:'absolute',left:`${cfg.dateX}mm`,top:`${cfg.dateY}mm`,display:'flex',gap:'.7mm'}}>{scbDateDigits.map((digit,index)=><span key={index} style={{width:'5mm',height:'5mm',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:700,boxSizing:'border-box',marginLeft:index===2||index===4?'1.1mm':0}}>{digit}</span>)}</div> : <div style={{position:'absolute',left:`${cfg.dateX}mm`,top:`${cfg.dateY}mm`,fontSize:'13px',whiteSpace:'nowrap'}}>{date}</div>}
          <div style={{position:'absolute',left:`${cfg.amountTextX}mm`,top:`${cfg.amountTextY}mm`,fontWeight:700,fontSize:`${cfg.amountTextFontSize}px`,whiteSpace:'nowrap'}}>{amountText}</div>
          <div style={{position:'absolute',left:`${cfg.amountX}mm`,top:`${cfg.amountY}mm`,fontWeight:700,fontSize:'16px',whiteSpace:'nowrap'}}>{money(voucher.net_amount)}</div>
        </div>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',marginBottom:'10px',flexWrap:'wrap'}}>
        <label style={{display:'flex',alignItems:'center',gap:'8px',margin:0,fontWeight:700}}>
          <input type="checkbox" checked={accountPayee} onChange={(e)=>setAccountPayee(e.target.checked)} style={{width:'18px',height:'18px'}} />
          A/C PAYEE ONLY
        </label>
        <button className="mini ghost" onClick={()=>setShowSettings((x)=>!x)}>
          {showSettings?'ซ่อนการตั้งค่า':'⚙ ตั้งค่าตำแหน่ง'}
        </button>
      </div>

      {showSettings&&<>
        <div className="form-grid">
          <label>ความกว้างเช็ค (mm)<input type="number" step="0.5" value={cfg.width} onChange={(e)=>set('width',e.target.value)} /></label>
          <label>ความสูงเช็ค (mm)<input type="number" step="0.5" value={cfg.height} onChange={(e)=>set('height',e.target.value)} /></label>
          <label>ชื่อผู้รับ X (mm)<input type="number" step="0.5" value={cfg.payeeX} onChange={(e)=>set('payeeX',e.target.value)} /></label>
          <label>ชื่อผู้รับ Y (mm)<input type="number" step="0.5" value={cfg.payeeY} onChange={(e)=>set('payeeY',e.target.value)} /></label>
          <label>วันที่ X (mm)<input type="number" step="0.5" value={cfg.dateX} onChange={(e)=>set('dateX',e.target.value)} /></label>
          <label>วันที่ Y (mm)<input type="number" step="0.5" value={cfg.dateY} onChange={(e)=>set('dateY',e.target.value)} /></label>
          <label>จำนวนเงิน X (mm)<input type="number" step="0.5" value={cfg.amountX} onChange={(e)=>set('amountX',e.target.value)} /></label>
          <label>จำนวนเงิน Y (mm)<input type="number" step="0.5" value={cfg.amountY} onChange={(e)=>set('amountY',e.target.value)} /></label>
          <label>จำนวนเงินตัวอักษร X (mm)<input type="number" step="0.5" value={cfg.amountTextX} onChange={(e)=>set('amountTextX',e.target.value)} /></label>
          <label>จำนวนเงินตัวอักษร Y (mm)<input type="number" step="0.5" value={cfg.amountTextY} onChange={(e)=>set('amountTextY',e.target.value)} /></label>
          <label>ขนาดตัวอักษรจำนวนเงิน (px)<input type="number" min="9" max="24" step="1" value={cfg.amountTextFontSize} onChange={(e)=>set('amountTextFontSize',e.target.value)} /></label>
          <label>A/C PAYEE X (mm)<input type="number" step="0.5" value={cfg.accountPayeeX} onChange={(e)=>set('accountPayeeX',e.target.value)} /></label>
          <label>A/C PAYEE Y (mm)<input type="number" step="0.5" value={cfg.accountPayeeY} onChange={(e)=>set('accountPayeeY',e.target.value)} /></label>
        </div>
        <div className="actions" style={{marginTop:'10px',marginBottom:'10px'}}>
          <button className="ghost" onClick={()=>{setCfg(defaults);localStorage.removeItem('vela-cheque-layout')}}>คืนค่าเริ่มต้น</button>
          <button className="ghost" onClick={save}>บันทึกตำแหน่ง</button>
        </div>
      </>}

      <div className="info-message">{isScb?'ไทยพาณิชย์: วันที่จะแสดงเป็น 8 หลักแยกช่อง DD MM YYYY (พ.ศ.) · ':''}แนะนำให้ทดสอบบนกระดาษธรรมดาก่อนวางเช็คจริง และตั้ง Scale = 100% / Actual size ในหน้าพิมพ์</div>
      <div className="actions" style={{marginTop:'14px'}}>
        <button onClick={openPrint}>เปิด Preview พิมพ์</button>
      </div>
    </div>
  </div>;
}

function PaymentDocumentsPanel({ mode, project, expenses, vendors, onUpdated }) {
  const [vouchers,setVouchers]=useState([]);
  const [company,setCompany]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [editingPayment,setEditingPayment]=useState(null);
  const [previewCheque,setPreviewCheque]=useState(null);
  const expenseMap=useMemo(()=>Object.fromEntries(expenses.map((e)=>[e.id,e])),[expenses]);

  async function load() {
    if (!project?.id) return;
    const [voucherRows, companyProfile] = await Promise.all([
      api(`/payment-vouchers?project_id=${project.id}`),
      api('/company-profile'),
    ]);
    setVouchers(voucherRows);
    setCompany(companyProfile);
  }
  useEffect(()=>{ load(); },[project?.id]);

  const rows = mode==='wht' ? vouchers.filter((v)=>Number(v.withholding_tax)>0)
    : mode==='cheque' ? vouchers.filter((v)=>v.payment_method==='CHEQUE' || v.cheque_no)
    : vouchers;

  function printVoucher(v) {
    const voucherExpenseIds = v.expense_ids?.length ? v.expense_ids : (v.expense_id ? [v.expense_id] : []);
    const voucherExpenses = voucherExpenseIds.map((id)=>expenseMap[id]).filter(Boolean);
    const e=voucherExpenses[0];
    const voucherAllocations = v.allocations?.length
      ? v.allocations
      : voucherExpenses.map((item)=>({expense_id:item.id,gross_amount:item.total_amount,withholding_tax:item.withholding_tax,net_amount:Math.max(Number(item.total_amount||0)-Number(item.withholding_tax||0),0)}));
    const allocationMap = Object.fromEntries(voucherAllocations.map((a)=>[a.expense_id,a]));
    const vendor=vendors.find((x)=>x.id===v.vendor_id);
    const method=({TRANSFER:'โอนเงิน',CASH:'เงินสด',CHEQUE:'เช็ค',CREDIT:'เครดิต / เจ้าหนี้'})[v.payment_method]||v.payment_method||'-';
    printDocument(v.voucher_no,`<style>
      @page{size:A4 portrait;margin:10mm}
      html,body{margin:0;padding:0}
      body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#000;font-size:10.5px}
      .pv-page{height:277mm;border:1.2px solid #000;padding:8mm;display:flex;flex-direction:column}
      .pv-head{display:grid;grid-template-columns:1.45fr .9fr .9fr;align-items:start;gap:10px;border-bottom:1px solid #000;padding-bottom:7px}
      .company{font-size:10.5px;line-height:1.45}.company b{font-size:12px}
      .title{text-align:center}.title h1{font-size:22px;margin:0;line-height:1.1}.title b{font-size:10px}
      .meta{display:grid;grid-template-columns:auto 1fr;gap:5px 8px;align-items:center}.meta span{font-weight:700}.meta b{border-bottom:1px solid #000;padding:1px 4px;text-align:right}
      .party{display:grid;grid-template-columns:135px 1fr;border-bottom:1px solid #000}.party div{padding:6px 7px}.party .label{font-weight:700;border-right:1px solid #000}
      .payment-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid #000}
      .payment-row div{padding:6px 7px;border-right:1px solid #000}.payment-row div:last-child{border-right:0}
      table{width:100%;border-collapse:collapse}
      .items{margin-top:8px}.items th,.items td{border:1px solid #000;padding:6px;vertical-align:top}
      .items th{background:#f4f4f4;text-align:center}.num{text-align:right;white-space:nowrap}
      .summary{width:48%;margin:8px 0 0 auto}.summary td{border:1px solid #000;padding:6px}.summary td:last-child{text-align:right;font-weight:700}
      .spacer{flex:0 0 24mm;height:24mm}
      .explain{border:1px solid #000;padding:8px;margin-top:8px;min-height:24mm}
      .sign{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #000;border-right:0;margin-top:8px}
      .sign .cell{border-right:1px solid #000;text-align:center;min-height:38mm;padding:6px;display:flex;flex-direction:column;justify-content:flex-end;gap:4px}
      .sign .role{font-weight:700}.sign .date{font-size:9px}
      .warning{margin-top:7px;border:1px solid #a33;color:#a33;padding:6px;font-weight:700}
      .foot{font-size:8.5px;color:#333;margin-top:5px;padding-bottom:2mm}
    </style>
    <div class="pv-page">
      <div class="pv-head">
        <div class="company"><b>${company?.legal_name||'Sea Mountain'}</b><br>${company?.address||''}<br>เลขประจำตัวผู้เสียภาษี ${company?.tax_id||'-'}${company?.phone? `<br>โทร. ${company.phone}`:''}</div>
        <div class="title"><h1>ใบสำคัญจ่าย</h1><b>PAYMENT VOUCHER</b></div>
        <div class="meta"><span>เลขที่</span><b>${v.voucher_no}</b><span>วันที่</span><b>${thaiDate(v.voucher_date)}</b></div>
      </div>

      <div class="party"><div class="label">จ่ายให้ / PAY TO</div><div><b>${v.payee_name}</b>${vendor?.tax_id? ` &nbsp; Tax ID: ${vendor.tax_id}`:''}</div></div>
      <div class="party"><div class="label">ที่อยู่</div><div>${vendor?.address||'-'}</div></div>

      <div class="payment-row">
        <div><b>วิธีจ่าย:</b> ${method}</div>
        <div><b>ธนาคาร:</b> ${v.bank_name||'-'}</div>
        <div><b>เลขที่เช็ค / อ้างอิง:</b> ${v.cheque_no||'-'}</div>
      </div>
      <div class="payment-row">
        <div><b>วันที่เช็ค:</b> ${v.cheque_date?thaiDate(v.cheque_date):'-'}</div>
        <div><b>จำนวนบิล:</b> ${voucherExpenses.length || 1} รายการ</div>
        <div><b>อ้างอิง:</b> ${voucherExpenses.map((x)=>x.expense_no).join(', ') || '-'}</div>
      </div>

      <table class="items">
        <thead><tr><th style="width:8%">วันที่</th><th style="width:14%">เลขเอกสาร</th><th>รายละเอียด</th><th style="width:14%">ยอดงวดนี้</th><th style="width:12%">หัก ณ ที่จ่าย</th><th style="width:14%">จ่ายสุทธิ</th></tr></thead>
        <tbody>${(voucherExpenses.length?voucherExpenses:[e]).filter(Boolean).map((item)=>{const a=allocationMap[item.id]||{};return `<tr>
          <td>${thaiDate(item?.expense_date)}</td>
          <td>${item?.document_no||item?.expense_no||'-'}</td>
          <td>${item?.description||'-'}</td>
          <td class="num">${money(a.gross_amount??item?.total_amount)}</td>
          <td class="num">${money(a.withholding_tax??0)}</td>
          <td class="num"><b>${money(a.net_amount??Math.max(Number(a.gross_amount||0)-Number(a.withholding_tax||0),0))}</b></td>
        </tr>`}).join('')}</tbody>
      </table>

      <table class="summary">
        <tr><td>ยอดเอกสาร</td><td>${money(v.gross_amount)}</td></tr>
        <tr><td>หัก ณ ที่จ่าย</td><td>- ${money(v.withholding_tax)}</td></tr>
        <tr><td><b>ยอดจ่ายสุทธิ</b></td><td><b>${money(v.net_amount)}</b></td></tr>
      </table>

      ${v.payment_method==='CHEQUE' && (!v.cheque_no || !v.bank_name) ? '<div class="warning">ข้อมูลเช็คยังไม่ครบ — กรุณาระบุธนาคารและเลขที่เช็คก่อนใช้เอกสารฉบับนี้จริง</div>' : ''}

      <div class="spacer"></div>

      <div class="explain"><b>คำอธิบาย / Explanation</b><br>${v.notes||voucherExpenses.map((x)=>x.description).join(' / ')||e?.description||'-'}</div>

      <div class="sign">
        <div class="cell"><div class="role">ผู้จัดทำ / Prepared By</div><div>........................................</div><div class="date">วันที่ ....../....../......</div></div>
        <div class="cell"><div class="role">ผู้ตรวจสอบ / Checked By</div><div>........................................</div><div class="date">วันที่ ....../....../......</div></div>
        <div class="cell"><div class="role">ผู้อนุมัติ / Approved By</div><div>........................................</div><div class="date">วันที่ ....../....../......</div></div>
        <div class="cell"><div class="role">ผู้รับเงิน / Received By</div><div>........................................</div><div class="date">วันที่ ....../....../......</div></div>
      </div>
      <div class="foot">${company?.legal_name||'Sea Mountain'} — Payment Voucher ${v.voucher_no}</div>
    </div>`);
  }

  function printWht(v) {
    const voucherExpenseIds = v.expense_ids?.length ? v.expense_ids : (v.expense_id ? [v.expense_id] : []);
    const voucherExpenses = voucherExpenseIds.map((id)=>expenseMap[id]).filter(Boolean);
    const e=voucherExpenses[0];
    const vendor=vendors.find((x)=>x.id===v.vendor_id);
    const allocationByExpense = Object.fromEntries((v.allocations||[]).map((a)=>[a.expense_id,a]));
    const base=voucherExpenses.length
      ? voucherExpenses.reduce((sum,item)=>{
          const allocation=allocationByExpense[item.id];
          const gross=Number(allocation?.gross_amount ?? item.total_amount ?? 0);
          const total=Number(item.total_amount||0);
          const subtotal=Number(item.subtotal||0);
          return sum + (total ? gross*subtotal/total : gross);
        },0)
      : Number(v.gross_amount||0);
    const rate=v.wht_rate!=null ? Number(v.wht_rate) : (base ? Number(v.withholding_tax||0)/base*100 : 0);
    const incomeLabel=v.income_type||voucherExpenses.map((item)=>item.description).join(' / ')||e?.description||'อื่น ๆ';
    const isService=/บริการ|จ้าง|ทำของ|โฆษณา|เช่า|ขนส่ง|ก่อสร้าง|ซ่อม|ทาสี|มุงหลังคา|ติดตั้ง|ปรับปรุง/i.test(incomeLabel);
    const rowAmount=(active)=>active ? money(base) : '';
    const rowTax=(active)=>active ? money(v.withholding_tax) : '';
    const rowDate=(active)=>active ? thaiDate(v.voucher_date) : '';

    const copy=(copyNo, copyText)=>`
    <section class="wht-standard">
      <div class="wht-copy">ฉบับที่ ${copyNo} (${copyText})</div>
      <div class="wht-title">
        <h2>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h2>
        <h3>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</h3>
      </div>

      <div class="wht-book">
        <span>เล่มที่ <b>....................</b></span>
        <span>เลขที่ <b>${v.wht_certificate_no||''}</b></span>
      </div>

      <div class="wht-box">
        <b>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :-</b>
        <div class="wht-line"><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)</span><b>${company?.tax_id||'-'}</b></div>
        <div class="wht-line"><span>ชื่อ</span><b>${company?.legal_name||'Sea Mountain'}</b></div>
        <div class="wht-line"><span>ที่อยู่</span><b>${company?.address||'-'}</b></div>
      </div>

      <div class="wht-box">
        <b>ผู้ถูกหักภาษี ณ ที่จ่าย :-</b>
        <div class="wht-line"><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)</span><b>${vendor?.tax_id||'-'}</b></div>
        <div class="wht-line"><span>ชื่อ</span><b>${v.payee_name}</b></div>
        <div class="wht-line"><span>ที่อยู่</span><b>${vendor?.address||'-'}</b></div>
      </div>

      <div class="wht-ref">
        <span>ลำดับที่ ............ ในแบบ</span>
        <span>☐ (1) ภ.ง.ด.1ก</span>
        <span>☐ (2) ภ.ง.ด.1ก พิเศษ</span>
        <span>☐ (3) ภ.ง.ด.2</span>
        <span>${vendor?.entity_type==='INDIVIDUAL'?'☑':'☐'} (4) ภ.ง.ด.3</span>
        <span>☐ (5) ภ.ง.ด.2ก</span>
        <span>☐ (6) ภ.ง.ด.3ก</span>
        <span>${vendor?.entity_type==='JURISTIC'?'☑':'☐'} (7) ภ.ง.ด.53</span>
      </div>

      <table class="wht-table">
        <thead>
          <tr>
            <th>ประเภทเงินได้พึงประเมินที่จ่าย</th>
            <th>วัน เดือน หรือปีภาษี ที่จ่าย</th>
            <th>จำนวนเงินที่จ่าย</th>
            <th>ภาษีที่หัก และนำส่งไว้</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)</td><td></td><td></td><td></td></tr>
          <tr><td>2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)</td><td></td><td></td><td></td></tr>
          <tr><td>3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)</td><td></td><td></td><td></td></tr>
          <tr><td>4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)</td><td></td><td></td><td></td></tr>
          <tr><td>4. (ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)</td><td></td><td></td><td></td></tr>
          <tr class="${isService?'active-income':''}">
            <td>5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าเบี้ยประกันวินาศภัย ฯลฯ<br><b>รายละเอียด: ${incomeLabel}</b></td>
            <td>${rowDate(isService)}</td><td>${rowAmount(isService)}</td><td>${rowTax(isService)}</td>
          </tr>
          <tr class="${!isService?'active-income':''}">
            <td>6. อื่น ๆ (ระบุ) <b>${!isService?incomeLabel:''}</b></td>
            <td>${rowDate(!isService)}</td><td>${rowAmount(!isService)}</td><td>${rowTax(!isService)}</td>
          </tr>
          <tr class="wht-total"><td colspan="2"><b>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</b></td><td><b>${money(base)}</b></td><td><b>${money(v.withholding_tax)}</b></td></tr>
          <tr><td><b>รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)</b></td><td colspan="3">................................................................................................................</td></tr>
        </tbody>
      </table>

      <div class="wht-funds">เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์โรงเรียนเอกชน ............ บาท &nbsp;&nbsp; กองทุนประกันสังคม ............ บาท &nbsp;&nbsp; กองทุนสำรองเลี้ยงชีพ ............ บาท</div>

      <div class="wht-payer">
        <b>ผู้จ่ายเงิน</b>
        <span>☑ (1) หัก ณ ที่จ่าย</span>
        <span>☐ (2) ออกให้ตลอดไป</span>
        <span>☐ (3) ออกให้ครั้งเดียว</span>
        <span>☐ (4) อื่น ๆ (ระบุ) ............................</span>
      </div>

      ${vendor?.entity_type==='UNKNOWN' ? '<div class="wht-warning"><b>ข้อมูลไม่ครบ:</b> กรุณาระบุประเภทผู้รับเงินว่าเป็นบุคคลธรรมดาหรือนิติบุคคล เพื่อเลือก ภ.ง.ด.3 / ภ.ง.ด.53 ให้ถูกต้อง</div>' : ''}
      <div class="wht-warning"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ต้องปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
      <div class="wht-certify">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</div>

      <div class="wht-sign">
        <div>ลงชื่อ ............................................................ ผู้จ่ายเงิน</div>
        <div>............................................................</div>
        <div>(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</div>
        <div class="stamp">ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)</div>
      </div>
    </section>`;

    printDocument(v.wht_certificate_no||'50 ทวิ',
      `<style>
        @page{size:A4 portrait;margin:8mm}
        body{font-family:Arial,"Noto Sans Thai",sans-serif;font-size:10px}
        .wht-standard{min-height:277mm;page-break-after:always;color:#000}
        .wht-copy{font-size:10px;margin-bottom:2px}
        .wht-title{text-align:center;margin:2px 0 6px}
        .wht-title h2{font-size:18px;margin:0}.wht-title h3{font-size:12px;margin:2px 0}
        .wht-book{display:flex;justify-content:flex-end;gap:26px;margin-bottom:4px}
        .wht-box{border:1px solid #000;padding:5px 7px;margin-top:-1px}
        .wht-line{display:grid;grid-template-columns:210px 1fr;gap:8px;padding:2px 0}
        .wht-ref{border:1px solid #000;border-top:0;padding:5px 7px;display:flex;flex-wrap:wrap;gap:4px 12px}
        .wht-table{width:100%;border-collapse:collapse;font-size:9px}
        .wht-table th,.wht-table td{border:1px solid #000;padding:4px;vertical-align:top}
        .wht-table th:nth-child(1){width:55%}.wht-table th:nth-child(2){width:15%}.wht-table th:nth-child(3),.wht-table th:nth-child(4){width:15%}
        .wht-table td:nth-child(n+2){text-align:right;white-space:nowrap}
        .wht-table .active-income td{font-weight:600}
        .wht-total td{background:#f6f6f6}
        .wht-funds{border:1px solid #000;border-top:0;padding:5px}
        .wht-payer{border:1px solid #000;border-top:0;padding:5px;display:flex;flex-wrap:wrap;gap:6px 16px}
        .wht-warning{font-size:8px;margin-top:5px}
        .wht-certify{text-align:center;margin-top:9px}
        .wht-sign{position:relative;width:52%;margin-left:auto;text-align:center;margin-top:8px;line-height:1.8}
        .stamp{position:absolute;left:-100px;top:0;border:1px solid #000;border-radius:50%;width:68px;height:68px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:8px}
        @media print{.wht-standard:last-child{page-break-after:auto}}
      </style>` +
      copy(1,'สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี') +
      copy(2,'สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน')
    );
  }

  function printCheque(v) {
    printDocument(v.cheque_no||v.voucher_no,`<div class="cheque"><div class="date">${thaiDate(v.cheque_date||v.voucher_date)}</div>
      <div class="payee">จ่าย <b>${v.payee_name}</b></div><div class="num">${money(v.net_amount)}</div>
      <p class="note">ธนาคาร: ${v.bank_name||'-'} &nbsp; เลขที่เช็ค: ${v.cheque_no||'-'}</p></div>
      <p class="note">ตำแหน่งพิมพ์เช็คเป็นแบบกลาง ต้องปรับระยะตามแบบเช็คของธนาคารก่อนพิมพ์บนเช็คจริง</p>`);
  }

  const title=mode==='wht'?'หัก ณ ที่จ่าย':mode==='cheque'?'พิมพ์เช็ค':'ใบสำคัญจ่าย';
  return <section className="panel">
    <div className="section-head"><div><h2>{title}</h2><p>{rows.length} รายการ</p></div>
      {mode==='voucher' && <button onClick={()=>setShowCreate(true)}>+ ออกใบสำคัญจ่าย</button>}
    </div>
    <div className="table-wrap"><table><thead><tr><th>เลขที่</th><th>วันที่</th><th>ผู้รับเงิน</th><th>ยอดเอกสาร</th><th>WHT</th><th>จ่ายสุทธิ</th><th>วิธีจ่าย</th><th>พิมพ์</th></tr></thead>
      <tbody>{rows.length===0&&<tr><td colSpan="8" className="empty">ยังไม่มีรายการ</td></tr>}
      {rows.map((v)=><tr key={v.id}><td className="mono">{mode==='wht'?(v.wht_certificate_no||'-'):mode==='cheque'?(v.cheque_no||'-'):v.voucher_no}</td>
        <td>{thaiDate(v.voucher_date)}</td><td>{v.payee_name}</td><td className="amount">{money(v.gross_amount)}</td><td className="amount">{money(v.withholding_tax)}</td><td className="amount">{money(v.net_amount)}</td><td>{v.payment_method||'-'}</td>
        <td><div className="row-actions"><button className="mini ghost" onClick={()=>mode==='wht'?printWht(v):mode==='cheque'?setPreviewCheque({...v,cheque_payee_name:vendors.find((x)=>x.id===v.vendor_id)?.cheque_payee_name||null}):printVoucher(v)}>{mode==='cheque'?'Preview':'พิมพ์'}</button>{mode==='voucher'&&<button className="mini ghost" onClick={()=>setEditingPayment(v)}>แก้ไขการจ่าย</button>}</div></td></tr>)}</tbody>
    </table></div>
    {showCreate&&<PaymentVoucherModal project={project} expenses={expenses} vendors={vendors} vouchers={vouchers} onClose={()=>setShowCreate(false)} onSaved={async()=>{setShowCreate(false);await load();await onUpdated();}} />}
    {editingPayment&&<PaymentEditModal voucher={editingPayment} onClose={()=>setEditingPayment(null)} onSaved={async()=>{setEditingPayment(null);await load();await onUpdated();}} />}
    {previewCheque&&<ChequePreviewModal voucher={previewCheque} onClose={()=>setPreviewCheque(null)} />}
  </section>;
}



function CompanySettingsPanel() {
  const [form,setForm]=useState({legal_name:'Sea Mountain',tax_id:'',address:'',branch:'',phone:''});
  const [saved,setSaved]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{ api('/company-profile').then((p)=>setForm({
    legal_name:p.legal_name||'Sea Mountain', tax_id:p.tax_id||'', address:p.address||'',
    branch:p.branch||'', phone:p.phone||''
  })).catch((e)=>setError(e.message)); },[]);

  const set=(k,v)=>setForm((x)=>({...x,[k]:v}));
  async function submit(e){
    e.preventDefault(); setError(''); setSaved('');
    try{
      await api('/company-profile',{method:'PUT',body:JSON.stringify({
        legal_name:form.legal_name, tax_id:form.tax_id||null, address:form.address||null,
        branch:form.branch||null, phone:form.phone||null
      })});
      setSaved('บันทึกข้อมูลบริษัทแล้ว');
    }catch(err){setError(err.message);}
  }
  return <section className="panel">
    <div className="section-head"><div><h2>ตั้งค่าบริษัท</h2><p>ข้อมูลผู้จ่ายสำหรับใบสำคัญจ่ายและหนังสือรับรอง 50 ทวิ</p></div></div>
    <form className="form-grid" onSubmit={submit}>
      <label>ชื่อจดทะเบียน<input value={form.legal_name} onChange={(e)=>set('legal_name',e.target.value)} required /></label>
      <label>เลขประจำตัวผู้เสียภาษี<input value={form.tax_id} onChange={(e)=>set('tax_id',e.target.value)} /></label>
      <label>สาขา<input value={form.branch} onChange={(e)=>set('branch',e.target.value)} placeholder="สำนักงานใหญ่ / สาขา 00001" /></label>
      <label>โทรศัพท์<input value={form.phone} onChange={(e)=>set('phone',e.target.value)} /></label>
      <label className="wide">ที่อยู่<textarea rows="3" value={form.address} onChange={(e)=>set('address',e.target.value)} /></label>
      {error&&<div className="error wide">{error}</div>}
      {saved&&<div className="wide status paid">{saved}</div>}
      <div className="actions wide"><button>บันทึกข้อมูลบริษัท</button></div>
    </form>
  </section>;
}

function App() {
  const [projects, setProjects] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [showExpense, setShowExpense] = useState(false);
  const [showVendor, setShowVendor] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [attachingExpense, setAttachingExpense] = useState(null);
  const [active, setActive] = useState('expenses');
  const [error, setError] = useState('');
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseMonth, setExpenseMonth] = useState('');
  const [expenseCostCode, setExpenseCostCode] = useState('');
  const [expenseVendor, setExpenseVendor] = useState('');
  const [expenseStatus, setExpenseStatus] = useState('');
  const [expensePage, setExpensePage] = useState(1);
  const [expensePageSize, setExpensePageSize] = useState(25);
  const [moreOpen, setMoreOpen] = useState(false);

  const project = projects[0];

  async function loadBase() {
    try {
      setError('');
      const [p, c, v] = await Promise.all([api('/projects'), api('/cost-codes'), api('/vendors')]);
      setProjects(p);
      setCostCodes(c);
      setVendors(v);
      if (p[0]) {
        const e = await api(`/expenses?project_id=${p[0].id}`);
        setExpenses(e);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadBase(); }, []);

  async function voidExpense(expense) {
    if (expense.payment_status !== 'UNPAID' || Number(expense.net_paid || 0) > 0) {
      setError('รายการที่มีการจ่ายแล้วต้องไม่ยกเลิกจากทะเบียนค่าใช้จ่าย');
      return;
    }
    const reason = window.prompt(`เหตุผลที่ยกเลิก ${expense.expense_no}`);
    if (!reason || reason.trim().length < 3) return;
    const confirmed = window.confirm(`ยืนยันยกเลิก ${expense.expense_no} ?\n\nรายการจะไม่ถูกลบ แต่จะเปลี่ยนสถานะเป็น VOID และไม่ถูกนับใน Dashboard/รายงาน`);
    if (!confirmed) return;
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

  const expenseMonths = useMemo(() => [...new Set(
    expenses.filter((e) => e.expense_date).map((e) => String(e.expense_date).slice(0,7))
  )].sort().reverse(), [expenses]);

  const filteredExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    return expenses.filter((e) => {
      if (expenseMonth && !String(e.expense_date || '').startsWith(expenseMonth)) return false;
      if (expenseCostCode && String(e.cost_code_id) !== String(expenseCostCode)) return false;
      if (expenseVendor && String(e.vendor_id || '') !== String(expenseVendor)) return false;
      if (expenseStatus && e.payment_status !== expenseStatus) return false;
      if (!q) return true;
      const haystack = [
        e.expense_no, e.document_no, e.description,
        vendorMap[e.vendor_id], costMap[e.cost_code_id]
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [expenses, expenseSearch, expenseMonth, expenseCostCode, expenseVendor, expenseStatus, vendorMap, costMap]);

  const expensePageCount = Math.max(1, Math.ceil(filteredExpenses.length / expensePageSize));
  const currentExpensePage = Math.min(expensePage, expensePageCount);
  const pagedExpenses = useMemo(() => {
    const start = (currentExpensePage - 1) * expensePageSize;
    return filteredExpenses.slice(start, start + expensePageSize);
  }, [filteredExpenses, currentExpensePage, expensePageSize]);
  const activeExpenseFilters = [
    expenseMonth && { label: `เดือน ${expenseMonth}`, clear: () => setExpenseMonth('') },
    expenseCostCode && { label: `หมวด ${costCodes.find((c) => String(c.id) === String(expenseCostCode))?.code || expenseCostCode}`, clear: () => setExpenseCostCode('') },
    expenseVendor && { label: vendorMap[expenseVendor] || 'ผู้ขาย', clear: () => setExpenseVendor('') },
    expenseStatus && { label: ({ PAID: 'จ่ายแล้ว', UNPAID: 'ยังไม่จ่าย', PARTIAL: 'บางส่วน', VOID: 'ยกเลิก' })[expenseStatus], clear: () => setExpenseStatus('') },
  ].filter(Boolean);

  useEffect(() => { setExpensePage(1); }, [expenseSearch, expenseMonth, expenseCostCode, expenseVendor, expenseStatus, expensePageSize]);

  const dashboardSummary = useMemo(() => expenses
    .filter((e) => e.payment_status !== 'VOID')
    .reduce((acc, e) => {
      const total = Number(e.total_amount || 0);
      const wht = Number(e.withholding_tax || 0);
      const paid = Number(e.net_paid || 0);
      acc.total += total;
      acc.wht += wht;
      acc.paid += paid;
      acc.outstanding += Math.max(total - wht - paid, 0);
      return acc;
    }, { total: 0, wht: 0, paid: 0, outstanding: 0 }), [expenses]);

  const cards = [
    ['ต้นทุนตามเอกสาร', money(dashboardSummary.total)],
    ['จ่ายผู้ขายสุทธิ', money(dashboardSummary.paid)],
    ['หัก ณ ที่จ่าย', money(dashboardSummary.wht)],
    ['ยอดค้างผู้ขาย', money(dashboardSummary.outstanding)],
  ];

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">SM</div>
          <div>
            <p className="eyebrow">Vela Construction Expense</p>
            <h1>{project?.name || 'Sea Mountain'}</h1>
            <p>ระบบบันทึกค่าใช้จ่ายและเอกสารโครงการก่อสร้าง</p>
          </div>
        </div>
        <button className="primary-action" onClick={() => setShowExpense(true)}>+ บันทึกค่าใช้จ่าย</button>
      </header>

      {error && <div className="error banner">{error}</div>}

      <section className="metric-grid">
        {cards.map(([label, value], index) => <article className="metric-card" key={label}><div className="metric-icon">{['฿','✓','%','◷'][index]}</div><div><span>{label}</span><strong>{value}</strong></div></article>)}
      </section>

      <nav className="tabs app-nav" aria-label="เมนูหลัก">
        <button className={active === 'expenses' ? 'active' : ''} onClick={() => setActive('expenses')}>ค่าใช้จ่าย</button>
        <button className={active === 'vendors' ? 'active' : ''} onClick={() => setActive('vendors')}>ผู้ขาย / ผู้รับเหมา</button>
        <button className={active === 'wht' ? 'active' : ''} onClick={() => setActive('wht')}>หัก ณ ที่จ่าย</button>
        <button className={active === 'voucher' ? 'active' : ''} onClick={() => setActive('voucher')}>ใบสำคัญจ่าย</button>
        <button className={active === 'cheque' ? 'active' : ''} onClick={() => setActive('cheque')}>พิมพ์เช็ค</button>
        <button className={active === 'reports' ? 'active' : ''} onClick={() => setActive('reports')}>รายงาน</button>
        <div className="nav-more"><button className={active === 'codes' || active === 'settings' || active === 'audit' ? 'active' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>เพิ่มเติม ▾</button>{moreOpen && <div className="nav-more-menu"><button onClick={() => { setActive('codes'); setMoreOpen(false); }}>Cost Codes</button><button onClick={() => { setActive('settings'); setMoreOpen(false); }}>ตั้งค่าบริษัท</button><button onClick={() => { setActive('audit'); setMoreOpen(false); }}>Audit Log</button></div>}</div>
      </nav>

      {active === 'expenses' && (
        <section className="panel expense-panel">
          <div className="section-head">
            <div><p className="section-kicker">ทะเบียนค่าใช้จ่าย</p><h2>รายการค่าใช้จ่าย</h2><p>แสดง {filteredExpenses.length} จาก {expenses.length} รายการ</p></div>
            <button className="section-add" onClick={() => setShowExpense(true)}>+ เพิ่มรายการ</button>
          </div>

          <div className="expense-toolbar">
            <div className="search-box">
              <span>⌕</span>
              <input aria-label="ค้นหาค่าใช้จ่าย" value={expenseSearch} onChange={(e)=>setExpenseSearch(e.target.value)} placeholder="ค้นหาเลขรายการ เอกสาร รายละเอียด ผู้ขาย หรือ Cost Code" />
            </div>
            <select value={expenseMonth} onChange={(e)=>setExpenseMonth(e.target.value)}>
              <option value="">ทุกเดือน</option>
              {expenseMonths.map((m)=><option key={m} value={m}>{new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric'}).format(new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1))}</option>)}
            </select>
            <select value={expenseCostCode} onChange={(e)=>setExpenseCostCode(e.target.value)}>
              <option value="">ทุก Cost Code</option>
              {costCodes.map((c)=><option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <select value={expenseVendor} onChange={(e)=>setExpenseVendor(e.target.value)}>
              <option value="">ทุกผู้ขาย</option>
              {vendors.map((v)=><option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={expenseStatus} onChange={(e)=>setExpenseStatus(e.target.value)}>
              <option value="">ทุกสถานะ</option>
              <option value="PAID">จ่ายแล้ว</option>
              <option value="UNPAID">ยังไม่จ่าย</option>
              <option value="PARTIAL">บางส่วน</option>
              <option value="VOID">ยกเลิก</option>
            </select>
            <button className="ghost filter-reset" onClick={()=>{setExpenseSearch('');setExpenseMonth('');setExpenseCostCode('');setExpenseVendor('');setExpenseStatus('')}}>ล้าง</button>
          </div>
          {(activeExpenseFilters.length > 0 || expenseSearch) && <div className="active-filters"><span>กำลังกรอง</span>{expenseSearch && <button onClick={() => setExpenseSearch('')}>ค้นหา: {expenseSearch} ×</button>}{activeExpenseFilters.map((filter) => <button key={filter.label} onClick={filter.clear}>{filter.label} ×</button>)}</div>}

          <div className="table-wrap expense-table-wrap">
            <table className="expense-table">
              <thead><tr><th>วันที่</th><th>เลขรายการ</th><th>รายละเอียด</th><th>หมวดงาน</th><th>ผู้ขาย</th><th>ยอด</th><th>เอกสาร</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
              <tbody>
                {pagedExpenses.length === 0 && <tr className="empty-row"><td colSpan="9" className="empty"><div className="empty-state"><strong>{expenses.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีค่าใช้จ่าย'}</strong><span>{expenses.length ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'เริ่มจากบันทึกค่าใช้จ่ายรายการแรกของโครงการ'}</span>{expenses.length ? <button className="ghost mini" onClick={() => { setExpenseSearch(''); setExpenseMonth(''); setExpenseCostCode(''); setExpenseVendor(''); setExpenseStatus(''); }}>ล้างตัวกรอง</button> : <button className="mini" onClick={() => setShowExpense(true)}>+ เพิ่มรายการ</button>}</div></td></tr>}
                {pagedExpenses.map((e) => (
                  <tr key={e.id}>
                    <td data-label="วันที่">{thaiDate(e.expense_date)}</td>
                    <td data-label="เลขรายการ" className="mono">{e.expense_no}<small className="expense-doc-no">{e.document_no || ''}</small></td>
                    <td data-label="รายละเอียด"><span className="expense-desc">{e.description}</span></td>
                    <td data-label="หมวดงาน">{costMap[e.cost_code_id] || '-'}</td>
                    <td data-label="ผู้ขาย">{vendorMap[e.vendor_id] || '-'}</td>
                    <td data-label="ยอด" className="amount">{money(e.total_amount)}</td>
                    <td data-label="เอกสาร">{e.paperless_document_id ? <span className="status paid">DOC #{e.paperless_document_id}</span> : (e.document_task_id ? <span className="status partial">OCR</span> : '-')}</td>
                    <td data-label="สถานะ"><span className={`status ${e.payment_status.toLowerCase()}`}>{({UNPAID:'ยังไม่จ่าย',PARTIAL:'บางส่วน',PAID:'จ่ายแล้ว',VOID:'ยกเลิก'})[e.payment_status]}</span></td>
                    <td data-label="จัดการ">
                      <div className="row-actions">
                        <button className="mini ghost" title="แก้ไข" aria-label={`แก้ไข ${e.expense_no}`} disabled={e.payment_status === 'VOID'} onClick={() => setEditingExpense(e)}><span aria-hidden="true">✎</span><span className="action-label">แก้ไข</span></button>
                        <button className="mini ghost" title={e.paperless_document_id ? 'เปลี่ยนเอกสาร' : 'แนบเอกสาร'} aria-label={`${e.paperless_document_id ? 'เปลี่ยนเอกสาร' : 'แนบเอกสาร'} ${e.expense_no}`} disabled={e.payment_status === 'VOID'} onClick={() => setAttachingExpense(e)}><span aria-hidden="true">▣</span><span className="action-label">{e.paperless_document_id ? 'เปลี่ยนเอกสาร' : 'แนบเอกสาร'}</span></button>
                        <button className="mini danger" title={e.payment_status==='UNPAID'?'ยกเลิก':'มีการจ่ายแล้ว — ยกเลิกไม่ได้'} aria-label={`ยกเลิก ${e.expense_no}`} disabled={e.payment_status !== 'UNPAID' || Number(e.net_paid || 0) > 0} onClick={() => voidExpense(e)}><span aria-hidden="true">×</span><span className="action-label">ยกเลิก</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <div className="page-size">แสดง
              <select value={expensePageSize} onChange={(e)=>setExpensePageSize(Number(e.target.value))}>
                <option value="25">25</option><option value="50">50</option><option value="100">100</option>
              </select>
              รายการ
            </div>
            <div className="page-info">{filteredExpenses.length ? ((currentExpensePage-1)*expensePageSize+1) : 0}–{Math.min(currentExpensePage*expensePageSize,filteredExpenses.length)} จาก {filteredExpenses.length}</div>
            <div className="page-buttons">
              <button className="ghost mini" disabled={currentExpensePage<=1} onClick={()=>setExpensePage((p)=>Math.max(1,p-1))}>‹ ก่อนหน้า</button>
              <span>หน้า {currentExpensePage} / {expensePageCount}</span>
              <button className="ghost mini" disabled={currentExpensePage>=expensePageCount} onClick={()=>setExpensePage((p)=>Math.min(expensePageCount,p+1))}>ถัดไป ›</button>
            </div>
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
                <span>{v.entity_type === 'INDIVIDUAL' ? 'บุคคลธรรมดา' : v.entity_type === 'JURISTIC' ? 'นิติบุคคล' : 'ยังไม่ระบุประเภทผู้รับเงิน'}</span>
                <span>{v.tax_id ? `Tax ID: ${v.tax_id}` : 'ไม่ระบุเลขภาษี'}</span>
                {v.cheque_payee_name && <span>จ่ายเช็ค: {v.cheque_payee_name}</span>}
                <span>{v.phone || ''}</span>
                <button className="mini ghost" onClick={() => setEditingVendor(v)}>แก้ไข</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {active === 'documents' && <DocumentPanel expenses={expenses} project={project} costCodes={costCodes} vendors={vendors} onUpdated={loadBase} />}

      {active === 'wht' && <PaymentDocumentsPanel mode="wht" project={project} expenses={expenses} vendors={vendors} onUpdated={loadBase} />}
      {active === 'voucher' && <PaymentDocumentsPanel mode="voucher" project={project} expenses={expenses} vendors={vendors} onUpdated={loadBase} />}
      {active === 'cheque' && <PaymentDocumentsPanel mode="cheque" project={project} expenses={expenses} vendors={vendors} onUpdated={loadBase} />}
      {active === 'reports' && <ReportPanel project={project} expenses={expenses} costCodes={costCodes} vendors={vendors} />}
      {active === 'settings' && <CompanySettingsPanel />}
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
      {editingVendor && (
        <VendorModal
          existing={editingVendor}
          onClose={() => setEditingVendor(null)}
          onSaved={async () => { setEditingVendor(null); await loadBase(); }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
