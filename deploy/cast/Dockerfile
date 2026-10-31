FROM python:3.12-slim
RUN pip install --no-cache-dir catt==0.12.12
COPY keep-casting.py /keep-casting.py
CMD ["python", "-u", "/keep-casting.py"]
