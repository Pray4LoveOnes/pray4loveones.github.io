(function () {
  'use strict';
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () { const open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); });
    nav.querySelectorAll('a').forEach(function (link) { link.addEventListener('click', function () { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }); });
  }
  const form = document.querySelector('#inquiry-form');
  const result = document.querySelector('#inquiry-result');
  const summary = document.querySelector('#inquiry-summary');
  const copyButton = document.querySelector('#copy-inquiry');
  const downloadButton = document.querySelector('#download-inquiry');
  const status = document.querySelector('#copy-status');
  let inquiryText = '';
  function value(name) { const field = form.elements[name]; return field ? field.value.trim() : ''; }
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      inquiryText = ['AGENTCHAIN TECHNICAL EVALUATION INQUIRY','========================================','', 'Name: ' + value('name'),'Company: ' + value('company'),'Role: ' + value('role'),'Email: ' + value('email'),'Company size: ' + value('companySize'),'Organization type: ' + value('organizationType'),'Primary use case: ' + value('useCase'),'Networks / infrastructure: ' + (value('networks') || 'Not specified'),'Interest type: ' + value('interestType'),'','Discussion context:',value('description'),'','Generated locally at https://pray4loveones.github.io/','No data was transmitted by this form.'].join('\n');
      summary.textContent = inquiryText; result.hidden = false; result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
  if (copyButton) copyButton.addEventListener('click', async function () { try { await navigator.clipboard.writeText(inquiryText); status.textContent = 'Inquiry copied to your clipboard.'; } catch (error) { status.textContent = 'Copy is unavailable here; select the summary text manually.'; } });
  if (downloadButton) downloadButton.addEventListener('click', function () { const blob = new Blob([inquiryText], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'agentchain-inquiry.txt'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); status.textContent = 'Inquiry downloaded as agentchain-inquiry.txt.'; });
}());
