# OMS International Shipping - Order Creation UI Inspection Report

## Overview
Inspection of OMS (`https://sr-pos-oms-web.nisims.web.id/international-shipping`) via Playwright UI automation under account `kevin.d.imas@gmail.com`.

---

## Authentication Mechanism
- **Login Flow**: Homepage (`/`) -> Click **"Masuk Sekarang"** -> Ant Design modal opens -> Enter email and password -> Click submit button -> Authenticated session captured to `.sessions/staging-oms_kevin_d_imas_gmail_com_session.json`.

---

## Order Creation Workflow: International Shipping (Non-Contract Policy)

Under the global **Non-Contract Ordering Policy**, contract-based ordering is bypassed. Navigating to `/international-shipping` opens the non-contract order creation flow directly:

### Stage 1: Detail Pengiriman (Shipment & Route Details)
Initiated directly by clicking **`+ Tambah Pengiriman`** (`button.shipment-title`). Contract selection (`Pilih Kontrak Anda`) is not selected or searched.
1. **Moda Transportasi** (*Mandatory*): Radio buttons (`Land`, `Air`, `Sea Freight`). Under `Air`, segmented selector (`Cargo` vs `Express`).
2. **Asal (Origin)** (*Mandatory*):
   - Type: Radio (`Door` vs `Port`).
   - Negara (Country): Dropdown (e.g. `Indonesia`).
   - Kota / Kabupaten: Cascading dropdown filtered by Country (e.g. `Balaraja, Kabupaten Tangerang, Banten 15610`).
   - Kode Pos: Numeric input.
   - Layanan Tambahan (Optional): Checkboxes (`Large Forklift`, `Hand Forklift`, `Dock Load`, `Crane`).
3. **Tujuan (Destination)** (*Mandatory*):
   - Type: Radio (`Door` vs `Port`).
   - Negara: Dropdown (e.g. `Singapore`).
   - Kota / Kabupaten: Cascading dropdown (e.g. `Orchard, Singapore, Singapore 238801`).
   - Kode Pos: Numeric input.
   - Layanan Tambahan (Optional): Checkboxes.
4. **Incoterm** (*Mandatory*): Dropdown options (`DDP`, `DAP`, `DPU`, `FAS`, `CIP`, `CPT`, `CIF`, `CFR`, `FOB`, `FCA`).
5. **Karakteristik Produk** (*Mandatory*): Dropdown options (`General Cargo`, `Special Cargo`, `Special Regulation`, `Domestic Cargo`).
6. **Estimasi Tanggal Pickup** (*Mandatory*): Ant Design date picker (`Pilih Tanggal`).
7. **Informasi Muatan / Kemasan** (*Mandatory*): `+ Tambah Kemasan` dialog (Jumlah, Berat Kotor, Length, Width, Height, Jenis Kemasan, Komoditas, Kode HS).

### Stage 2: Pilih Layanan (Service Catalog Matching)
- Inspect available Service Catalogs matching the route, mode, and cargo.
- **Mandatory Policy**: If no applicable catalog exists and only Inquiry (`Ajukan Inquiry Layanan`) is presented, halt immediately without redirecting to Inquiry.

### Stage 3: Informasi Shipper & Consignee
- Enter PIC details for Pickup (Shipper) and Drop-off (Consignee).

### Stage 4: Ringkasan Pengiriman & Pembayaran
- Review shipping cost, breakdown, terms, and submit order.
