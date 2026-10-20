# Boreal Workstation - local label connector (USB / Bluetooth Windows queue), Windows PowerShell 5.1+
# No installation, administrator account, scheduled task or firewall change.
$ErrorActionPreference = 'Stop'
$BorealOrigin = 'https://boreal.example.invalid'
$BorealPort = 19183
$BorealToken = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class BorealRawPrinter {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Doc { [MarshalAs(UnmanagedType.LPWStr)] public string Name; [MarshalAs(UnmanagedType.LPWStr)] public string Output; [MarshalAs(UnmanagedType.LPWStr)] public string Type; }
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint StartDocPrinter(IntPtr handle,int level,ref Doc doc);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr handle,byte[] data,int length,out int written);
 static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
 public static uint Send(string name,byte[] data){IntPtr h;Check(OpenPrinter(name,out h,IntPtr.Zero));bool docStarted=false,pageStarted=false;try{var doc=new Doc{Name="Boreal - etiqueta OS",Type="RAW"};uint id=StartDocPrinter(h,1,ref doc);Check(id!=0);docStarted=true;Check(StartPagePrinter(h));pageStarted=true;int written;Check(WritePrinter(h,data,data.Length,out written));if(written!=data.Length)throw new Exception("Incomplete spool write; check the queue before retrying.");Check(EndPagePrinter(h));pageStarted=false;Check(EndDocPrinter(h));docStarted=false;return id;}finally{if(pageStarted)EndPagePrinter(h);if(docStarted)EndDocPrinter(h);ClosePrinter(h);}}
}
'@
function Get-BorealPrinters {
 @((Get-CimInstance Win32_Printer) | Where-Object { (($_.Name -match 'RW[ -]?420' -or $_.DriverName -match 'RW[ -]?420') -and $_.PortName -match '^USB') -or (($_.Name -match '(ZQ[ -]?520|XM7[ -]?40)' -or $_.DriverName -match '(ZQ[ -]?520|XM7[ -]?40)') -and $_.PortName -match '^(COM[0-9]+:?$|USB)') } | ForEach-Object { [ordered]@{name=$_.Name;port=$_.PortName} })
}
$BorealJobs = @{}
$BorealListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,$BorealPort)
try { $BorealListener.Start() } catch { Write-Host 'Porta ocupada. Feche outro conector Boreal antes de iniciar.'; Read-Host 'Enter para fechar'; exit 1 }
Write-Host 'Conector Boreal Impressao em funcionamento. Mantenha esta janela aberta.'
Write-Host 'No CRM, abra Expedição > Pós-venda > OS > Imprimir etiqueta > Configurar impressao.'
Write-Host ('Codigo de conexao (copie para o CRM): ' + $BorealToken)
Write-Host 'Feche esta janela para interromper o conector.'
try {
 while ($true) {
  $BorealClient=$BorealListener.AcceptTcpClient();$BorealClient.ReceiveTimeout=10000;$BorealClient.SendTimeout=10000;$BorealStream=$BorealClient.GetStream()
  $BorealStatus=200;$BorealResponse=@{error='Solicitacao invalida.'};$BorealAllowed=$false
  try {
   $BorealBytes=New-Object 'System.Collections.Generic.List[byte]';$BorealTail=''
   while($BorealTail -ne "`r`n`r`n") { $BorealByte=$BorealStream.ReadByte();if($BorealByte -lt 0){throw 'Conexao encerrada.'};$BorealBytes.Add([byte]$BorealByte);if($BorealBytes.Count -gt 8192){throw 'Cabecalho excedido.'};if($BorealBytes.Count -ge 4){$BorealTail=[Text.Encoding]::ASCII.GetString($BorealBytes.ToArray(),$BorealBytes.Count-4,4)} }
   $BorealLines=[Text.Encoding]::ASCII.GetString($BorealBytes.ToArray()).Split(@("`r`n"),[StringSplitOptions]::None);$BorealFirst=$BorealLines[0].Split(' ');$BorealHeaders=@{}
   foreach($BorealLine in $BorealLines){$BorealColon=$BorealLine.IndexOf(':');if($BorealColon -gt 0){$BorealHeaders[$BorealLine.Substring(0,$BorealColon).ToLowerInvariant()]=$BorealLine.Substring($BorealColon+1).Trim()}}
   if($BorealHeaders['host'] -ne "127.0.0.1:$BorealPort"){throw 'Host invalido.'}
   if($BorealHeaders['origin'] -ne $BorealOrigin){$BorealStatus=403;throw 'Origem nao autorizada.'};$BorealAllowed=$true
   if($BorealFirst[0] -eq 'OPTIONS'){$BorealResponse=@{ok=$true}}
   else {
    if($BorealHeaders['x-boreal-token'] -cne $BorealToken){$BorealStatus=403;throw 'Codigo de conexao invalido.'}
    if($BorealFirst[0] -eq 'GET' -and $BorealFirst[1] -eq '/printers'){$BorealResponse=@{printers=@(Get-BorealPrinters)}}
    elseif($BorealFirst[0] -eq 'POST' -and $BorealFirst[1] -eq '/print'){
     if($BorealHeaders.ContainsKey('transfer-encoding')){throw 'Formato nao permitido.'}
     if($BorealHeaders['content-type'] -notlike 'application/json*'){throw 'Formato nao permitido.'}
     $BorealLength=0;if(![int]::TryParse($BorealHeaders['content-length'],[ref]$BorealLength) -or $BorealLength -lt 1 -or $BorealLength -gt 4096){throw 'Tamanho invalido.'}
     $BorealBody=New-Object byte[] $BorealLength;$BorealRead=0
     while($BorealRead -lt $BorealLength){$BorealCount=$BorealStream.Read($BorealBody,$BorealRead,$BorealLength-$BorealRead);if($BorealCount -le 0){throw 'Solicitacao incompleta.'};$BorealRead+=$BorealCount}
     $BorealData=[Text.Encoding]::UTF8.GetString($BorealBody)|ConvertFrom-Json
     if([string]$BorealData.os -notmatch '^\d{6}(\d{2})?$' -or [long]$BorealData.os -lt 1){throw 'Numero da OS invalido.'}
     if([string]$BorealData.jobId -notmatch '^[a-f0-9-]{36}$'){throw 'Identificador invalido.'}
     if($BorealJobs.ContainsKey([string]$BorealData.jobId)){
      $BorealPrevious=$BorealJobs[[string]$BorealData.jobId];if($BorealPrevious.os -ne $BorealData.os -or $BorealPrevious.printer -ne $BorealData.printer){throw 'Identificador ja utilizado.'};$BorealResponse=$BorealPrevious.response
     }else{
      $BorealPrinter=@(Get-BorealPrinters | Where-Object {$_.name -ceq [string]$BorealData.printer});if($BorealPrinter.Count -ne 1){throw 'Impressora nao encontrada. Configure a XM7-40 ou ZQ-520 na porta COM Bluetooth, ou a RW-420 USB no Windows.'}
      $BorealDigits=[string]$BorealData.os;$BorealBarcodeWidth=(11*(3+$BorealDigits.Length/2)+13)*2;$BorealX=[int]((240-$BorealBarcodeWidth)/2)
      $BorealZpl="^XA^PW240^LL120^LH0,0^BY2^FO$BorealX,8^BCN,55,N,N,N^FD>;$BorealDigits^FS^FO0,74^A0N,22,18^FB240,1,0,C,0^FD$BorealDigits^FS^PQ1^XZ"
      # Record before spooling: an ambiguous transport failure never silently prints twice.
      $BorealJobs[[string]$BorealData.jobId]=@{os=$BorealDigits;printer=$BorealData.printer;response=@{error='Envio anterior incerto. Confira a fila e a etiqueta antes de imprimir novamente.'}}
      $BorealSpoolId=[BorealRawPrinter]::Send([string]$BorealData.printer,[Text.Encoding]::ASCII.GetBytes($BorealZpl))
      $BorealResponse=@{ok=$true;spoolJobId=$BorealSpoolId;message='Etiqueta enviada a fila do Windows. Confira a impressao fisica.'};$BorealJobs[[string]$BorealData.jobId].response=$BorealResponse
      Write-Host ("OS $BorealDigits enviada para " + $BorealData.printer)
     }
    }else{$BorealStatus=404;throw 'Recurso nao encontrado.'}
   }
  }catch{if($BorealStatus -eq 200){$BorealStatus=400};$BorealResponse=@{error=$_.Exception.Message}}
  try{
   $BorealPayload=[Text.Encoding]::UTF8.GetBytes(($BorealResponse|ConvertTo-Json -Compress -Depth 6));$BorealCors=''
   if($BorealAllowed){$BorealCors="Access-Control-Allow-Origin: $BorealOrigin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type, X-Boreal-Token`r`nAccess-Control-Allow-Private-Network: true`r`nVary: Origin`r`n"}
   $BorealHttp="HTTP/1.1 $BorealStatus Response`r`nContent-Type: application/json; charset=utf-8`r`nCache-Control: no-store`r`nConnection: close`r`n$BorealCors" + 'Content-Length: ' + $BorealPayload.Length + "`r`n`r`n"
   $BorealHead=[Text.Encoding]::ASCII.GetBytes($BorealHttp);$BorealStream.Write($BorealHead,0,$BorealHead.Length);$BorealStream.Write($BorealPayload,0,$BorealPayload.Length)
  }catch{}finally{$BorealClient.Close()}
 }
}finally{$BorealListener.Stop()}
