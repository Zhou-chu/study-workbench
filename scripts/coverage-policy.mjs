export function assessCoverage(row,digest,inputs,reportHash) {
 const reasons=[];
 if(!row?.inputDigest||row.inputChangedDuringRun||row.inputDigest!==inputs)reasons.push('changed/stale run inputs');
 if(!row?.reportHash||row.reportHash!==reportHash)reasons.push('changed/missing coverage report');
 if(!row||row.phase!=='complete'||row.testExitCode!==0||row.blocked||row.missingReport)reasons.push('missing/blocked/failed run');
 if(!row?.audit||(!Array.isArray(row.audit.missing)||row.audit.missing.length||!Array.isArray(row.audit.unexpected)||row.audit.unexpected.length))reasons.push('missing source audit/files');
 if(row?.sourceChangedDuringRun||row?.sourceDigest!==digest)reasons.push('source changed or stale report');
 for(const metric of ['statements','branches','functions','lines']){
  const value=row?.coverage?.[metric];
  if(!value||!Number.isSafeInteger(value.total)||!Number.isSafeInteger(value.covered)||value.total<=0||value.covered<0||value.covered>value.total)reasons.push(metric+': invalid/N/A (not a pass)');
  else if(10*value.covered<=9*value.total)reasons.push(metric+': '+value.covered+'/'+value.total+' is not >90%');
 }
 return reasons;
}
