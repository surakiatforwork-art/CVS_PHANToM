# Report History Upsert and LINE Note Flow

## Scope

This change applies to both the Web App and the native Android APK.

The Web App will be committed and pushed after verification. The Android app will be built, tested, copied to `releases`, and installed on the connected device.

## 1. Replace Duplicate History Within the Same Copy Day

### Required behavior

- Pressing `Copy` continues to save the generated report to History immediately.
- Pressing `Share / LINE` on Android follows the same History rule because it currently records the report as part of that action.
- A report is considered a duplicate when it belongs to the same store and was copied on the same local calendar day.
- The newest report replaces the older History record instead of creating another row.
- The replacement updates the full report text, SKU selections, summary-topic selections, report date, and update timestamp.
- The existing History ID should be preserved where possible so selected History state does not break.
- The updated item should be ordered as the newest item.
- The same store copied on a different day remains a separate History record.

### Store identity

Use the following identity order:

1. `sheetName + placeId` when both values are available.
2. Normalized `account + branchCode + branchName` for legacy or standalone records.

Copy-day comparison uses the local date derived from `createdAt`, not only the report date entered in the form.

### Compatibility

- Existing Web and Android History records without `sheetName` or `placeId` must continue to load.
- Legacy records use the account/branch fallback identity.
- Existing selected History entries remain selected after replacement when their ID is preserved.

## 2. Android LINE Flow for Creating a LINE Note

### Required behavior

The Android `Share / LINE` button must not use `Intent.ACTION_SEND` and must not prefill a LINE chat message.

The button flow will be:

1. Generate the current Report text.
2. Copy the Report text to the Android clipboard.
3. Upsert the Report into History using the same-day duplicate rule.
4. Save the store `noted` data as currently implemented.
5. Resolve the LINE destination using the same account mapping as the Web App.
6. Open the LINE application directly so the user can create a Note and paste the clipboard content manually.

### Button behavior

- `Copy`: clipboard + History upsert; do not open LINE.
- `Share / LINE`: clipboard + History upsert + open LINE.
- Report Preview `Share` will follow the same clipboard + open-LINE behavior to avoid accidentally sending text to a chat.

### LINE launch fallback

- Prefer opening the resolved LINE URL with the LINE Android package `jp.naver.line.android`.
- If LINE cannot handle the package-targeted intent, retry the URL without a package restriction.
- If LINE is unavailable, keep the text in the clipboard and show a clear status message; do not lose the Report or History entry.
- Do not automatically paste, submit, or send any message.

## 3. Web App Changes

- Change History insertion to same-day store upsert.
- Preserve compatibility with History stored by earlier versions.
- Keep the current `COPY (ไม่เปิด LINE)` behavior.
- Keep `COPY + เปิด LINE กลุ่ม`, but ensure History is replaced rather than duplicated.
- Apply the same upsert rule to History generated through the embedded Report popup in `index.html`.
- Push the verified Web changes to `origin/main`.

## 4. Android Changes

- Add store identity fields needed by History (`sheetName` and `placeId`).
- Update LocalStore serialization with backward-compatible defaults.
- Replace exact-text deduplication with same-store/same-copy-day upsert.
- Replace Android Sharesheet usage for Report with clipboard + direct LINE launch.
- Keep generic text sharing only where it is explicitly intended and does not conflict with the LINE Note workflow.
- Build a new APK version and install it with `adb install -r` to retain local data.

## 5. Verification

- Copy one store twice on the same day after changing Report content: History contains one row with the latest content.
- Copy the same store on a different local day: History contains two rows.
- Verify fallback duplicate matching for a legacy History record without `placeId`.
- Verify Copy updates clipboard but does not launch LINE.
- Verify Share / LINE updates clipboard and opens LINE without a prefilled chat message.
- Verify LINE-not-installed fallback leaves the clipboard and History intact.
- Verify daily summary uses the latest replacement record only.
- Run Web JavaScript checks and browser console verification.
- Run Android unit tests, lint, and APK build; then install and open it on the connected device.

