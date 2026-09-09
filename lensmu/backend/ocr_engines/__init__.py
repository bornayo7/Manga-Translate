"""Paddle and Manga library adapters, loaded lazily by OcrRuntime.

Adapters own one model and its library-specific image/result contract. The
runtime owns decoding, cache reuse, admission, worker lifetime and status.
"""
