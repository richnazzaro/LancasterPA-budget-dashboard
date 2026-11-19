
import pdfplumber
import pandas as pd
import sys

def clean_currency(value):
    if value is None: return 0.0
    val_str = str(value).replace('$', '').replace(',', '').replace(' ', '')
    if '(' in val_str and ')' in val_str:
        val_str = '-' + val_str.replace('(', '').replace(')', '')
    clean_str = "".join(c for c in val_str if c.isdigit() or c in '.-')
    try: return float(clean_str)
    except ValueError: return 0.0

def extract_budget(pdf_path):
    results = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text: continue
            lines = text.split('\n')
            
            in_summary = False
            for line in lines:
                if "REVENUE SUMMARY" in line.upper():
                    in_summary = True
                    continue
                
                if in_summary:
                    if "TOTAL GENERAL FUND" in line.upper() or "SURPLUS" in line.upper():
                        continue
                    
                    parts = line.split()
                    if len(parts) > 3:
                        has_numbers = any(any(c.isdigit() for c in p) for p in parts[1:])
                        if has_numbers and "DESCRIPTION" not in line.upper() and "TOTAL" not in line.upper():
                            nums = []
                            for p in parts:
                                val = clean_currency(p)
                                if val != 0 or (',' in p or '$' in p):
                                    nums.append(val)
                            
                            target_val = 0.0
                            if len(nums) >= 4:
                                mid = len(nums) // 2
                                for j in range(mid, len(nums)):
                                    if nums[j] > 1000:
                                        target_val = nums[j]
                                        break
                            
                            if target_val > 0:
                                # Capture description as the primary name
                                desc = " ".join(parts[:3]) if len(parts) > 2 else parts[0]
                                desc = desc.replace('$', '').strip()

                                results.append({
                                    "fiscal_year": 2027,
                                    "bureau": "", # Do not assume bureau; leave empty if not identified
                                    "fund": "GENERAL_FUND",
                                    "account_code": "", 
                                    "account_name": desc, # This is where the description goes
                                    "category": "REVENUE",
                                    "amount": target_val,
                                    "doc_type": "proposed",
                                    "source_page": i + 1
                                })

    df = pd.DataFrame(results)
    output_path = "/Users/rich/Lancaster Dashboard/data/raw_extraction.csv"
    df.to_csv(output_path, index=False)
    print(f"Successfully extracted {len(df)} rows to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_budget.py <path_to_pdf>")
    else:
        extract_budget(sys.argv[1])
