param(
  [Parameter(Mandatory=$true)][string]$Konclude,
  [string]$CasesFile = "Tests/owl2-test-cases/approved/ofn/cases.txt",
  [string]$WorkDir = "Tests/owl2-test-cases/approved/ofn/tmp",
  [string]$ExpectedFailures = "Tests/owl2-test-cases/expected-failures.txt"
)

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

$expected = @{}
if (Test-Path $ExpectedFailures) {
  Get-Content $ExpectedFailures | ForEach-Object {
    $line = $_
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.TrimStart().StartsWith("#")) { return }
    $expected[$line.Trim()] = $true
  }
}

$fail = 0
$count = 0
$xfail = 0
$xpass = 0
Get-Content $CasesFile | ForEach-Object {
  $line = $_
  if ([string]::IsNullOrWhiteSpace($line)) { return }
  if ($line.TrimStart().StartsWith("#")) { return }
  $parts = $line -split "`t"
  if ($parts.Length -lt 2) { return }
  $expect = $parts[0]
  $path = $parts[1]
  $caseId = $parts.Length -ge 3 ? $parts[2] : $path
  $count += 1
  $out = Join-Path $WorkDir ((Split-Path $path -Leaf) + ".out")
  & $Konclude consistency -i $path -o $out | Out-Default
  if (-not (Test-Path $out)) {
    if ($expected.ContainsKey($caseId)) {
      Write-Host "XFAIL $caseId: missing output"
      $xfail += 1
      return
    }
    Write-Host "FAIL $caseId: missing output"
    $fail = 1
    return
  }
  $got = (Get-Content $out -Raw).Trim().ToLowerInvariant()
  if ($got -ne $expect) {
    if ($expected.ContainsKey($caseId)) {
      Write-Host "XFAIL $caseId: expected $expect got $got"
      $xfail += 1
      return
    }
    Write-Host "FAIL $caseId: expected $expect got $got"
    $fail = 1
  } else {
    if ($expected.ContainsKey($caseId)) {
      Write-Host "XPASS $caseId"
      $xpass += 1
      $fail = 1
    }
  }
}

Write-Host "Ran $count cases (XFAIL=$xfail XPASS=$xpass)"
if ($fail -ne 0) { exit 1 }
