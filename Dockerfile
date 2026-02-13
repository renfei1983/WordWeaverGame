# Use official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the backend directory contents into the container at /app
COPY backend/ /app

# Install any needed packages specified in requirements.txt
# Using Tsinghua mirror for faster builds in China
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# Make port 80 available to the world outside this container
EXPOSE 80

# Define environment variable
ENV PORT=80

# Run app.py when the container launches
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-80}"]
