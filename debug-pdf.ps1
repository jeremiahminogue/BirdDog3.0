pip install pdfplumber
python server/parse-summary.py "Z:\Weekly Job Reports\032426 Summary Report.pdf" --debug 2>debug.txt
Write-Host "`nDebug output saved to debug.txt"
Write-Host "First 100 lines:"
Get-Content debug.txt -Head 100
