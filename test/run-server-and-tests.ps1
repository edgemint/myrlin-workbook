$env:CWM_PASSWORD = 'test123'
$env:PORT = '3458'

$pinfo = New-Object System.Diagnostics.ProcessStartInfo
$pinfo.FileName = 'node'
$pinfo.Arguments = 'test/start-server.js'
$pinfo.WorkingDirectory = 'C:\Projects\workbook'
$pinfo.UseShellExecute = $false
$pinfo.CreateNoWindow = $true
$pinfo.RedirectStandardOutput = $true
$pinfo.RedirectStandardError = $true
$pinfo.EnvironmentVariables['CWM_PASSWORD'] = 'test123'
$pinfo.EnvironmentVariables['PORT'] = '3458'
$pinfo.EnvironmentVariables['PATH'] = $env:PATH

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $pinfo

$outLines = [System.Collections.Concurrent.ConcurrentBag[string]]::new()
$errLines = [System.Collections.Concurrent.ConcurrentBag[string]]::new()

$outJob = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action { $outLines.Add($Event.SourceEventArgs.Data) }
$errJob = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action { $errLines.Add($Event.SourceEventArgs.Data) }

$null = $proc.Start()
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

Write-Host "Server PID: $($proc.Id), waiting 6s for startup..."
Start-Sleep -Seconds 6

Write-Host "Server stdout: $($outLines -join ', ')"
Write-Host "Server stderr: $(($errLines | Select-Object -First 3) -join ', ')"

Write-Host "Running tests..."
$env:CWM_PASSWORD = 'test123'
$env:PORT = '3458'
node test/e2e-api.js
$exitCode = $LASTEXITCODE

if (-not $proc.HasExited) { $proc.Kill() }
Unregister-Event -SourceIdentifier $outJob.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $errJob.Name -ErrorAction SilentlyContinue
Write-Host "Exit code: $exitCode"
exit $exitCode
