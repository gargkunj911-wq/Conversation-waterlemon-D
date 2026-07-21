import json
import os
import shutil
import tempfile
import traceback

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import geminimodel
from . import pdfInput


app = FastAPI(title="Client Intelligence Report Generator")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate-report/stream")
async def generate_report_stream(
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    model: str = Form(...),
):

    model = model.strip().lower()
    if model not in ("gemini", "qwen"):
        raise HTTPException(status_code=400, detail="model must be 'gemini' or 'qwen'")

    if not file and not (text and text.strip()):
        raise HTTPException(status_code=400, detail="Provide either a PDF file or pasted text")

    if text and text.strip():
        conversation_text = text.strip()
    else:
        if file.content_type not in ("application/pdf", "application/octet-stream"):
            raise HTTPException(status_code=400, detail="Please upload a PDF file")


        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                shutil.copyfileobj(file.file, tmp)
                tmp_path = tmp.name

            conversation_text = pdfInput.extract_text(tmp_path)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)

    if not conversation_text or not conversation_text.strip():
        raise HTTPException(status_code=422, detail="No conversation text found")

    report_generator = (
        geminimodel.generate_reports_stream
        if model == "gemini"
        else qwenmodel.generate_reports_stream
    )

    def ndjson_stream():
        try:
            for chunk in report_generator(conversation_text):
                yield json.dumps(chunk) + "\n"
        except Exception as exc:
            traceback.print_exc()
            yield json.dumps({"type": "error", "message": str(exc)}) + "\n"

    return StreamingResponse(ndjson_stream(), media_type="application/x-ndjson")


FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


# Run with: uvicorn main:app --reload --port 8000
