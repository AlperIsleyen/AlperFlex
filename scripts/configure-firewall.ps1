$ErrorActionPreference = 'Stop'
$port = 3000
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'PowerShell penceresini Yönetici olarak açıp komutu yeniden çalıştırın.'
}
Write-Output 'Güvenlik duvarı kuralları taranıyor; bu işlem birkaç dakika sürebilir...'
# Windows'un önceden açtığı tüm portları kapsayan Node.js Public kuralları
# uygulamaya tanımlanan dar TCP 3000 kuralını etkisiz bırakır.
Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | ForEach-Object {
  $rule = $_
  $app = $rule | Get-NetFirewallApplicationFilter
  $portFilter = $rule | Get-NetFirewallPortFilter
  $addr = $rule | Get-NetFirewallAddressFilter
  if ($app.Program -match '(?i)\\node\.exe$' -and $portFilter.LocalPort -eq 'Any' -and $addr.RemoteAddress -eq 'Any') {
    $rule | Disable-NetFirewallRule
    Write-Output "Geniş Node.js kuralı kapatıldı: $($rule.DisplayName)"
  }
}
$rules = @(
  @{ Name = 'AlperFlex LAN'; Remote = 'LocalSubnet'; Profile = 'Any'; Interface = @('Wi-Fi', 'Ethernet') },
  @{ Name = 'AlperFlex Tailscale'; Remote = '100.64.0.0/10'; Profile = 'Any'; Interface = 'Tailscale' }
)
foreach ($rule in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  if ($existing) { $existing | Remove-NetFirewallRule }
  $params = @{
    DisplayName = $rule.Name; Direction = 'Inbound'; Action = 'Allow'; Enabled = 'True';
    Protocol = 'TCP'; LocalPort = $port; RemoteAddress = $rule.Remote; Profile = $rule.Profile
  }
  if ($rule.Interface) { $params.InterfaceAlias = $rule.Interface }
  New-NetFirewallRule @params | Out-Null
  Write-Output "Kural eklendi: $($rule.Name)"
}
Write-Output 'AlperFlex güvenlik duvarı kurulumu tamamlandı.'
