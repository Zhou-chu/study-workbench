import type { LanguageCode } from './locales';
export type RetrievalMessages = { refreshWarning: string; cancelWarning: string; retainedMarkdown: string; maintenanceRefresh: string; maintenanceRefreshWarning: string };
export const retrievalMessages = {
  "en-US": {
    "refreshWarning": "Refresh can reconcile these exact index jobs. It does not submit indexing. No automatic polling is used.",
    "cancelWarning": "Stopping local waiting may also stop undispatched siblings. Remote processing and costs may continue; this is not a refund or remote cancellation.",
    "retainedMarkdown": "Repair uses retained Markdown, not the original web page. This does not prove the file is intact.",
    "maintenanceRefresh": "Refresh this maintenance job",
    "maintenanceRefreshWarning": "This read may recover the same acknowledged local task. It does not start a new task or update historical citations."
  },
  "zh-CN": {
    "refreshWarning": "刷新可能核对此处确切索引任务的状态，不会提交索引，也不会自动轮询。",
    "cancelWarning": "停止本地等待也可能阻止尚未分派的同组任务。远程处理与费用可能继续；这不代表退款或远程取消。",
    "retainedMarkdown": "修复使用保留的 Markdown，而非原始网页。这不能证明文件完整。",
    "maintenanceRefresh": "刷新此维护任务",
    "maintenanceRefreshWarning": "此读取可能恢复同一个已确认的本地任务，不会新建任务或改写历史引用。"
  },
  "zh-TW": {
    "refreshWarning": "重新整理可能核對此處確切索引工作的狀態，不會提交索引，也不會自動輪詢。",
    "cancelWarning": "停止本機等待也可能阻止尚未派送的同組工作。遠端處理與費用可能繼續；這不代表退款或遠端取消。",
    "retainedMarkdown": "修復使用保留的 Markdown，而非原始網頁。這不能證明檔案完整。",
    "maintenanceRefresh": "重新整理此維護工作",
    "maintenanceRefreshWarning": "此讀取可能恢復同一個已確認的本機工作，不會建立新工作或改寫歷史引用。"
  },
  "ja-JP": {
    "refreshWarning": "更新はこれらの索引ジョブの状態を照合する場合があります。索引作成を送信せず、自動ポーリングもしません。",
    "cancelWarning": "ローカル待機の停止は未送信の同グループの処理も止める場合があります。リモート処理と費用は続く可能性があり、返金やリモート取消ではありません。",
    "retainedMarkdown": "修復には元のウェブページではなく保存された Markdown を使います。ファイルの完全性は保証しません。",
    "maintenanceRefresh": "この保守ジョブを更新",
    "maintenanceRefreshWarning": "この読取りは確認済みの同じローカル処理を回復する場合があります。新規処理や過去の引用の更新は行いません。"
  },
  "de-DE": {
    "refreshWarning": "Aktualisieren kann den Status genau dieser Indexaufträge abgleichen. Es startet keine Indexierung und fragt nicht automatisch ab.",
    "cancelWarning": "Lokales Warten zu stoppen kann auch noch nicht versandte Teilaufträge stoppen. Entfernte Verarbeitung und Kosten können weiterlaufen; dies ist keine Erstattung oder Fernstornierung.",
    "retainedMarkdown": "Die Reparatur nutzt gespeichertes Markdown, nicht die ursprüngliche Webseite. Die Dateiintegrität ist damit nicht nachgewiesen.",
    "maintenanceRefresh": "Diesen Wartungsauftrag aktualisieren",
    "maintenanceRefreshWarning": "Diese Abfrage kann denselben bestätigten lokalen Auftrag wiederherstellen. Sie startet keinen neuen Auftrag und ändert keine historischen Zitate."
  },
  "fr-FR": {
    "refreshWarning": "Actualiser peut rapprocher l’état de ces tâches d’indexation précises. Cela ne lance aucune indexation ni interrogation automatique.",
    "cancelWarning": "Arrêter l’attente locale peut aussi arrêter les tâches du groupe non encore envoyées. Le traitement distant et les coûts peuvent continuer ; ce n’est ni un remboursement ni une annulation distante.",
    "retainedMarkdown": "La réparation utilise le Markdown conservé, pas la page web d’origine. Cela ne prouve pas l’intégrité du fichier.",
    "maintenanceRefresh": "Actualiser cette tâche de maintenance",
    "maintenanceRefreshWarning": "Cette lecture peut récupérer la même tâche locale confirmée. Elle ne crée pas de tâche et ne modifie pas les citations historiques."
  },
  "es-ES": {
    "refreshWarning": "Actualizar puede conciliar el estado de estas tareas de índice concretas. No inicia indexación ni consultas automáticas.",
    "cancelWarning": "Detener la espera local también puede detener tareas del grupo aún no enviadas. El procesamiento remoto y los costes pueden continuar; no es un reembolso ni una cancelación remota.",
    "retainedMarkdown": "La reparación usa Markdown conservado, no la página web original. Esto no demuestra la integridad del archivo.",
    "maintenanceRefresh": "Actualizar esta tarea de mantenimiento",
    "maintenanceRefreshWarning": "Esta lectura puede recuperar la misma tarea local confirmada. No crea tareas ni modifica citas históricas."
  },
  "pt-BR": {
    "refreshWarning": "Atualizar pode reconciliar o estado destas tarefas específicas de índice. Não envia indexação nem faz consultas automáticas.",
    "cancelWarning": "Parar a espera local também pode parar tarefas do grupo ainda não enviadas. O processamento remoto e os custos podem continuar; isso não é reembolso nem cancelamento remoto.",
    "retainedMarkdown": "O reparo usa Markdown preservado, não a página original. Isso não comprova a integridade do arquivo.",
    "maintenanceRefresh": "Atualizar esta tarefa de manutenção",
    "maintenanceRefreshWarning": "Esta leitura pode recuperar a mesma tarefa local confirmada. Não cria outra tarefa nem altera citações históricas."
  },
  "it-IT": {
    "refreshWarning": "L’aggiornamento può riconciliare lo stato di questi esatti processi di indicizzazione. Non avvia indicizzazioni né interrogazioni automatiche.",
    "cancelWarning": "Interrompere l’attesa locale può fermare anche attività del gruppo non ancora inviate. Elaborazione remota e costi possono continuare; non è un rimborso né un annullamento remoto.",
    "retainedMarkdown": "La riparazione usa il Markdown conservato, non la pagina web originale. Non dimostra l’integrità del file.",
    "maintenanceRefresh": "Aggiorna questa attività di manutenzione",
    "maintenanceRefreshWarning": "Questa lettura può recuperare la stessa attività locale confermata. Non crea attività né modifica citazioni storiche."
  },
  "ca-ES": {
    "refreshWarning": "Actualitzar pot conciliar l’estat d’aquestes tasques d’índex concretes. No inicia indexació ni consultes automàtiques.",
    "cancelWarning": "Aturar l’espera local també pot aturar tasques del grup encara no enviades. El processament remot i els costos poden continuar; no és un reemborsament ni una cancel·lació remota.",
    "retainedMarkdown": "La reparació usa Markdown conservat, no la pàgina web original. Això no demostra la integritat del fitxer.",
    "maintenanceRefresh": "Actualitza aquesta tasca de manteniment",
    "maintenanceRefreshWarning": "Aquesta lectura pot recuperar la mateixa tasca local confirmada. No crea tasques ni modifica citacions històriques."
  },
  "pl-PL": {
    "refreshWarning": "Odświeżenie może uzgodnić stan dokładnie tych zadań indeksowania. Nie uruchamia indeksowania ani automatycznego odpytywania.",
    "cancelWarning": "Zatrzymanie lokalnego oczekiwania może też zatrzymać niewysłane zadania z grupy. Zdalne przetwarzanie i koszty mogą trwać; nie jest to zwrot ani zdalne anulowanie.",
    "retainedMarkdown": "Naprawa używa zachowanego Markdown, a nie oryginalnej strony. Nie potwierdza integralności pliku.",
    "maintenanceRefresh": "Odśwież to zadanie konserwacji",
    "maintenanceRefreshWarning": "Ten odczyt może wznowić to samo potwierdzone zadanie lokalne. Nie tworzy nowego zadania ani nie zmienia historycznych cytowań."
  },
  "tr-TR": {
    "refreshWarning": "Yenileme, tam olarak bu dizin görevlerinin durumunu uzlaştırabilir. Dizin oluşturma başlatmaz ve otomatik sorgulama yapmaz.",
    "cancelWarning": "Yerel beklemeyi durdurmak, gruptaki henüz gönderilmemiş görevleri de durdurabilir. Uzak işlem ve maliyetler sürebilir; bu bir iade veya uzak iptal değildir.",
    "retainedMarkdown": "Onarım, özgün web sayfasını değil saklanan Markdown içeriğini kullanır. Bu, dosya bütünlüğünü kanıtlamaz.",
    "maintenanceRefresh": "Bu bakım görevini yenile",
    "maintenanceRefreshWarning": "Bu okuma aynı onaylanmış yerel görevi kurtarabilir. Yeni görev başlatmaz veya geçmiş alıntıları değiştirmez."
  },
  "ru-RU": {
    "refreshWarning": "Обновление может сверить состояние именно этих заданий индексации. Оно не запускает индексацию и автоматический опрос.",
    "cancelWarning": "Остановка локального ожидания может также остановить ещё не отправленные задания группы. Удалённая обработка и расходы могут продолжаться; это не возврат средств и не удалённая отмена.",
    "retainedMarkdown": "Восстановление использует сохранённый Markdown, а не исходную веб-страницу. Это не подтверждает целостность файла.",
    "maintenanceRefresh": "Обновить это задание обслуживания",
    "maintenanceRefreshWarning": "Это чтение может восстановить то же подтверждённое локальное задание. Оно не создаёт новое задание и не меняет исторические цитаты."
  },
  "bn-IN": {
    "refreshWarning": "রিফ্রেশ এই নির্দিষ্ট সূচি কাজগুলির অবস্থা মিলিয়ে নিতে পারে। এটি সূচি তৈরি শুরু করে না বা স্বয়ংক্রিয়ভাবে খোঁজ নেয় না।",
    "cancelWarning": "স্থানীয় অপেক্ষা থামালে একই দলের এখনও না পাঠানো কাজও থামতে পারে। দূরবর্তী প্রক্রিয়া ও খরচ চলতে পারে; এটি অর্থ ফেরত বা দূরবর্তী বাতিল নয়।",
    "retainedMarkdown": "মেরামতে সংরক্ষিত Markdown ব্যবহৃত হয়, মূল ওয়েব পৃষ্ঠা নয়। এতে ফাইলের অখণ্ডতা প্রমাণিত হয় না।",
    "maintenanceRefresh": "এই রক্ষণাবেক্ষণের কাজটি রিফ্রেশ করুন",
    "maintenanceRefreshWarning": "এই পাঠ একই নিশ্চিত স্থানীয় কাজ পুনরুদ্ধার করতে পারে। এটি নতুন কাজ শুরু করে না বা পুরোনো উদ্ধৃতি বদলায় না।"
  }
} satisfies Record<LanguageCode, RetrievalMessages>;
