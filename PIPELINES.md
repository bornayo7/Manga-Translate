# PIPELINES.md

## Extension OCR -> translation -> overlay pipeline

1. User triggers translation from the popup
2. Popup sends a message to `background.js`
3. `background.js` coordinates the request and current settings
4. `content.js` scans page images and extracts usable image data
5. OCR runs through one of:
   - backend OCR
   - Tesseract.js
   - Cloud Vision
6. OCR results are grouped into text blocks
7. grouped text is sent to the selected translation provider
8. translated text is returned
9. `overlay.js` renders translated blocks back onto the image

## Debugging rule for this pipeline

Always trace:

OCR raw output
-> grouped blocks
-> translation request payload
-> translation response payload
-> final render payload

Do not assume the bug is in rendering just because the overlay is wrong.

## Backend OCR pipeline

image upload
-> FastAPI route in `server.py`
-> OCR engine wrapper
-> normalized OCR response
-> return bounding boxes and detected text

## Website pipeline

The website demo is a simpler flow than the extension:

upload image
-> website OCR path
-> translation path
-> client-side redraw

This surface should either:
- match extension capability, or
- be clearly labeled as a limited demo

## Settings sync pipeline

Desired model:

extension settings
-> split into synced vs local-only
-> sync only safe preferences to website/Auth0
-> merge synced preferences with extension local defaults

Never sync:
- API keys
- secrets
- backend URLs unless explicitly intended
