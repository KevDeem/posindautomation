# Reusable Order Specification Guide & Template

The Logistics Automation skill is fully **specification-driven**. Previous order values serve as a reusable baseline, allowing you to create subsequent orders by specifying only the fields that change (e.g. changing only the drop-off city, changing only the pickup PIC, or modifying cargo weight).

---

## 1. Specification Anatomy

An order specification can be provided via natural language or structured JSON/YAML. All fields are individually changeable:

```yaml
orderType: domestic # "domestic" | "international"
transportationMode: SEMUA # "SEMUA" | "Land" | "Air" | "Sea"
scheduledDate: "2026-11-19" # YYYY-MM-DD
scheduledTime: "10:00" # HH:mm

pickup:
  locationType: Door # "Door" | "Port"
  province: DKI Jakarta
  city: Jakarta Selatan
  district: Tebet
  subdistrict: Manggarai
  address: Tebet
  postalCode: "12850"
  pic:
    name: Kevin
    company: PT Mega Jaya Logistik
    address: Jl. Tebet Raya No. 12
    email: kevin@example.com
    phone: "08755029428339"

dropoff:
  locationType: Door # "Door" | "Port"
  province: Jawa Timur
  city: Surabaya
  district: Gubeng
  subdistrict: Pucang Sewu
  address: Gubeng
  postalCode: "60283"
  pic:
    name: Aldin
    company: Raceway Shop
    address: Jl. Gubeng No. 33
    email: aldin@example.com
    phone: "08755910333483"

cargo:
  characteristics: General Cargo # "General Cargo" | "Special Cargo" | etc.
  commodity: Elektronik
  itemName: Busi Denso
  weightKg: 50
  quantity: 1
  quantityUnit: PCS
  lengthCm: 50
  widthCm: 50
  heightCm: 50
  packagingType: Kardus XL

serviceCatalogPreference: LTL # Optional catalog preference (e.g. LTL, FTL, FUSO BOX)
```

---

## 2. Granular Field-Level Reuse Rules

When you provide a new order request:
1. **Explicitly Provided Fields**: Always take top priority and override previous values.
2. **Missing Fields**: Check the saved specification baseline (`.sessions/previous_order_spec.json`).
3. **Location Isolation**:
   - Changing **Pickup** does **not** alter or erase **Drop-off**.
   - Changing **Drop-off** does **not** alter or erase **Pickup**.
4. **Independent PICs**:
   - Pickup PIC and Drop-off PIC are managed completely independently.
   - Changing one PIC does not alter the other.
5. **No Transactional Reuse**:
   - Order IDs (`ORCA...`), Shipment IDs (`SOCB...`), and payment Virtual Account (VA) numbers are **never** reused. Fresh identifiers are always generated for new orders.
6. **Service Catalog Verification**:
   - Service Catalogs are re-evaluated dynamically in the UI based on the new route and cargo parameters. If no catalog is available, automation halts per policy and does not redirect to inquiry.

---

## 3. Dynamic PIC Generation Policy

If you do not want to supply personal contact details or prefer quick synthetic contacts:
- Request: *"Generate realistic PICs for both locations"* or *"Use a new pickup PIC"*.
- The system generates realistic Indonesian names, plausible company names (`PT ...`, `CV ...`), realistic addresses, valid Indonesian phone numbers (`08...`), and safe synthetic emails ending in `@example.com` (to protect real entities).

---

## 4. Pre-Submission Review Table

Before any order is finalized in the UI, the automation presents a complete resolved specification table indicating the exact origin of each value:
- `[Provided]`: Value supplied in the current prompt.
- `[Reused]`: Value remembered from the previous specification baseline.
- `[Generated Synthetic]`: Value synthesized via the safe PIC generator.
- `[UI Default]`: Value selected automatically from UI defaults or master data.
- `[MISSING]`: Mandatory field missing and requiring clarification.

---

## 5. Natural Language Specification Examples

### Example A: Change Drop-off Destination Only
> *"Create another domestic order, but change drop-off to Bandung (Lengkong, Malabar, Jawa Barat). Keep everything else the same."*

- **Result**: Pickup remains Tebet, cargo remains Busi Denso 50kg, Drop-off updates to Bandung.

### Example B: Change Cargo & Dimensions
> *"Create an order with the same route and contacts, but cargo is Sparepart Mesin, 25 KG, 40x40x30 CM, packaging Kayu M."*

- **Result**: Route and PICs reused; cargo details updated.

### Example C: Independent PIC Modification
> *"Use the previous shipment details, but change pickup PIC name to Bambang (081299887766) and generate a new drop-off PIC."*

- **Result**: Pickup PIC updated to Bambang; Drop-off PIC dynamically generated with synthetic profile; route and cargo preserved.

### Example D: Headless Request
> *"Run this order headlessly."*

- **Result**: Playwright runs in headless mode. (Default is headed mode so you can watch execution).

### Example E: Batch Orders (Quantity N)
> *"Create 5 domestic orders from Tebet to Gubeng at 08:00 on 1 Dec 2026. Run it headless."*

- **Result**: Generates 5 independent runtime order specifications. Submits each sequentially through the general order engine, executes payment via sandbox UI for each order, and reports individual Order IDs, VAs, and statuses. Zero transaction-specific scripts generated.

### Example F: Multi-Group Batch Orders
> *"Create 5 domestic orders from Tebet to Gubeng at 08:00, and 6 orders from Kesambi to Adiwerna at 10:00 on 1 Dec 2026. Pay them separately and retry failed orders up to twice."*

- **Result**: Normalizes into 11 batch transactions across 2 route groups. Executes sequentially with independent retry tracking per transaction.
