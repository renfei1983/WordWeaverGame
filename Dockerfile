# Use official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies required for building Python packages
# gcc, libc-dev, and python3-dev are often needed for compiling C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libc-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the backend directory contents into the container at /app
COPY backend/ /app

# Install any needed packages specified in requirements.txt
# Switch to Tencent Cloud mirror which is more stable in this environment
# Or fallback to official PyPI if mirrors fail
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple --default-timeout=100

# Make port 80 available to the world outside this container
EXPOSE 80

# Define environment variable
ENV PORT=80

# Run app.py when the container launches
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-80}"]
