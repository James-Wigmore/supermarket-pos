import { downloadFile } from '../lib/api';
import { printPage } from '../lib/desktop';
import { dateTime, fmtNum, label, money, num } from '../lib/format';
import type { Receipt as ReceiptData } from '../lib/types';
import { Button, Modal } from './ui';

export const ReceiptView = ({ receipt }: { receipt: ReceiptData }) => {
  const { sale, store } = receipt;
  return (
    <div className="print-area mx-auto w-[300px] bg-white font-mono text-xs leading-5">
      <div className="text-center">
        <div className="text-sm font-bold">{store.storeName}</div>
        {[store.branch, store.address, store.phone, store.header].filter(Boolean).map((t) => <div key={t}>{t}</div>)}
      </div>
      <div className="mt-2 border-t border-dashed border-ink pt-1">
        <div>Receipt {sale.receiptNo}{sale.status === 'VOIDED' && ' (VOIDED)'}</div>
        <div>{dateTime(sale.soldAt)}{sale.cashierName && ` · ${sale.cashierName}`}</div>
      </div>
      <div className="mt-1 border-t border-dashed border-ink py-1">
        {sale.items.map((i) => (
          <div key={i.id}>
            <div>{i.name}</div>
            <div className="flex justify-between"><span>{fmtNum(i.quantity)} x {fmtNum(i.unitPrice)}</span><span>{fmtNum(i.lineTotal)}</span></div>
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-ink pt-1">
        {num(sale.discountTotal) > 0 && <div className="flex justify-between"><span>Discount</span><span>-{fmtNum(sale.discountTotal)}</span></div>}
        {num(sale.taxTotal) > 0 && <div className="flex justify-between"><span>Tax included</span><span>{fmtNum(sale.taxTotal)}</span></div>}
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(sale.total)}</span></div>
        {sale.payments.map((p) => <div key={p.method + p.amount} className="flex justify-between"><span>{label(p.method)}</span><span>{fmtNum(p.amount)}</span></div>)}
        {num(sale.changeGiven) > 0 && <div className="flex justify-between"><span>Change</span><span>{fmtNum(sale.changeGiven)}</span></div>}
      </div>
      {store.footer && <div className="mt-2 text-center">{store.footer}</div>}
    </div>
  );
};

interface Props { receipt: ReceiptData | null; onClose: () => void; saleId?: string; queued?: boolean }

export const ReceiptModal = ({ receipt, onClose, saleId, queued }: Props) => (
  <Modal open={Boolean(receipt)} onClose={onClose} title="Receipt" width="sm"
    footer={
      <>
        {saleId && !queued && <Button variant="secondary" onClick={() => void downloadFile(`/sales/${saleId}/receipt.pdf`, undefined, null)}>Digital copy (PDF)</Button>}
        <Button variant="secondary" onClick={() => void printPage()}>Print</Button>
        <Button onClick={onClose}>Done</Button>
      </>
    }>
    {queued && <p className="mb-3 rounded-field bg-warn-soft px-3 py-2 text-sm text-warn">Saved offline. This sale will upload automatically when the connection returns.</p>}
    {receipt && <ReceiptView receipt={receipt} />}
  </Modal>
);
