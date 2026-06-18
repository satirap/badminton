# Payment v2 - Court Hours Numeric

## Changes:
- Court-by-court hour tracking (replaces simple courts × hours)
- Default court: **3** (editable)
- Add courts: auto-increment to 4, 5, 6, ... (editable)
- Calculation: total court-hours × rate per hour
- Formula display: "X court-hours @ YYY฿"
- Data persists to localStorage and Firestore

## How to use:
1. Enter court names (default: 3, 4, 5...)
2. Set hours per court
3. Delete courts with ✕ button
4. Add more courts with "+ เพิ่มคอร์ท"
5. Calculation updates automatically

## Files:
- payment.html - Updated UI + logic
