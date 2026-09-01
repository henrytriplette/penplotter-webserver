import UIkit from 'uikit';

// Nicer format for file list
export function renderFileListElement(name: string): string {

  // Het the file extension
  const re = /(?:\.([^.]+))?$/;
  const match = re.exec(name);
  const ext = match && match[1] ? match[1] : '';
  let html = ''

  switch (ext) {
    case 'hpgl':
    case 'hpg':
      html = `<div class="uk-grid uk-grid-small">
                <div class="uk-width-expand">
                  <a href="#" class="selectFile" data-filename="${name}">
                    <span>${name}</span>
                  </a>
                </div>
                <div class="uk-width-auto uk-text-right panel-icons">
                  <a href="#" class="uk-icon-link previewFile lock-edit" data-filename="${name}" title="Preview" data-uk-tooltip data-uk-icon="icon: eye"></a>
                  <a href="#" class="uk-icon-link deleteFile lock-edit" data-filename="${name}" title="Delete" data-uk-tooltip data-uk-icon="icon: close"></a>
                </div>
              </div>`;
        break;
    case 'svg':
      html = `<div class="uk-grid uk-grid-small">
                <div class="uk-width-expand">
                  <a href="#" class="no-selectFile" data-filename="${name}">
                    <span>${name}</span>
                  </a>
                </div>
                <div class="uk-width-auto uk-text-right panel-icons">
                  <a href="#" class="uk-icon-link convertFile lock-edit" data-filename="${name}" title="Convert to HPGL" data-uk-tooltip data-uk-icon="icon: bolt"></a>
                  <a href="#" class="uk-icon-link deleteFile lock-edit" data-filename="${name}" title="Delete" data-uk-tooltip data-uk-icon="icon: close"></a>
                </div>
              </div>`;
        break;
    default:
      html = `<div class="uk-grid uk-grid-small">
                <div class="uk-width-expand">
                  <a href="#" class="no-selectFile" data-filename="${name}">
                    <span>${name}</span>
                  </a>
                </div>
                <div class="uk-width-auto uk-text-right panel-icons">
                  <a href="#" class="uk-icon-link deleteFile lock-edit" data-filename="${name}" title="Delete" data-uk-tooltip data-uk-icon="icon: close"></a>
                </div>
              </div>`;
  }

  return html;
}

// Simplift notification handling
export function notify(message: string, status: "primary" | "success" | "warning" | "danger" | undefined) {
    UIkit.notification({
      message: message,
      status: status,
      pos: 'top-right',
      timeout: 5000
  });
}

export function scrollLog() {
  document.querySelectorAll('.auto-scroll').forEach((el) => {
    el.animate({
      scrollTop: el.scrollHeight
    }, 10);
  });
}
