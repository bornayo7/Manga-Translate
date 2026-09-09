# lensmu language

Terms for translating text inside images while preserving the reader's page context.

## Language

**Image target**:
One occurrence of an image on a webpage, with its own place in the reader's view. Two occurrences remain distinct targets even when their contents are identical.
_Avoid_: Image job, shared image

**Source image**:
The image contents from which text and region positions are recognized. A target can show a different source image later.
_Avoid_: Target, translated image

**Text region**:
A bounded portion of the source image containing related text, such as one speech bubble or caption.
_Avoid_: Translation, overlay

**OCR engine**:
A recognizer that reads text from image contents. It can identify region positions or read text from regions supplied to it.
_Avoid_: Translation provider

**Translation provider**:
A service that converts recognized text from the source language into the target language.
_Avoid_: OCR engine

**Prepared translation**:
Recognized text regions paired with their translation results, ready for a display attempt. Preparation alone does not mean the reader can see translated text.
_Avoid_: Rendered translation

**Overlay**:
The translated display positioned over an image target while the source page remains available.
_Avoid_: Source image, preparation

**Rendered region**:
A text region whose translated text was actually drawn for the reader.
_Avoid_: Successful request, prepared region

**Partial translation**:
A result in which some text regions are rendered and others remain untranslated or cannot be displayed.
_Avoid_: Complete translation

**Read-aloud**:
Spoken playback of translated text chosen by the reader.
_Avoid_: OCR, translation
