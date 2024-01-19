import os

def replace_file_extension(file_path, new_extension):
    # Split the file path into the directory and filename
    directory, filename = os.path.split(file_path)

    # Split the filename into the name and current extension
    name, current_extension = os.path.splitext(filename)

    # Replace the current extension with the new extension
    new_filename = f"{name}.{new_extension}"

    # Combine the directory and the new filename to get the updated file path
    updated_file_path = os.path.join(directory, new_filename)

    return updated_file_path