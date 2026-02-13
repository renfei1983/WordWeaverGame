# Use official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install any needed packages specified in requirements.txt
# Use mirror for faster install in China if needed, but standard is fine
RUN pip install --no-cache-dir -r requirements.txt

# Make port 80 available to the world outside this container
EXPOSE 80

# Define environment variable
ENV PORT=80

# Run app.py when the container launches
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-80}"]
