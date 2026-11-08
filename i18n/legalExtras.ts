import type { Lang } from './languages';

type ExtraDoc = {
  privacy: { title: string; body: string }[];
  terms: { title: string; body: string }[];
};

function sections(...pairs: [string, string][]): ExtraDoc {
  return {
    privacy: pairs.filter((_, i) => i < 4).map(([title, body]) => ({ title, body })),
    terms: pairs.filter((_, i) => i >= 4).map(([title, body]) => ({ title, body })),
  };
}

const docs: Record<Lang, ExtraDoc> = {
  en: sections(
    [
      'Data on this device and on the public network',
      'The 24-word phrase is the key to your account. It stays on this phone and in the backup you make; it is not written on the network. PIN, fingerprint and password only unlock this phone. Wallet addresses, credit, reputation, invitations and Reserva locks are written on a public network and can be seen by anyone who reads that network. A profile photo and a local identity photo may stay on this phone; the identity photo is not sent to our files. Email and phone are used for the account and notices.',
    ],
    [
      'Permissions and third parties',
      'The app may ask for camera (document or profile), notifications (payment and account alerts) and biometrics (to unlock this phone). Notices may be sent by specialised providers acting only on our instructions. If you link an external wallet, that wallet service and its connection layer apply their own policies. We do not sell your data, do not read your contacts to collect a debt and do not use location to approve credit.',
    ],
    [
      'Retention, children and your rights',
      'Off-network data (email, phone, notice records) is kept only while the account needs it. You may ask us to stop notices and to delete off-network copies. What is written on the public network cannot be erased. The service is only for people 18 or older. We do not knowingly serve children. Privacy: privacidad@quatriviumcredit.app',
    ],
    [
      'Changes to this policy',
      'If this policy changes in a material way, the app will ask you to read and accept the new version before you continue. The date of the version in force is shown when you accept. Version of 3 October 2026.',
    ],
    [
      'Reserva',
      'Reserva lets you lock USDT for 30 days. The locked amount returns to your account when the period ends. If a separate provision has funds, an estimated yield of up to 12% a year may be added for those days. That yield is not guaranteed and can be zero. Reserva is not a bank deposit, not a fixed term and not an investment product. Locking is available from level 10 and, on the Real account, after the same identity steps as credit.',
    ],
    [
      'Common fund and donations',
      'USDT placed in the common fund stays there to lend. A contribution is not a product you can withdraw. Donations are voluntary, go to the project wallet and do not enter the fund. There are no purchases inside Google Play: value moves on the public network.',
    ],
    [
      'Risks and the law where you live',
      'USDT and network fees can change in value. Transfers on the network cannot be reversed. If you lose the recovery phrase, that account cannot be reopened. A high credit level may have no funds. Quatrivium Finance provides the application; the protocol runs on the network. Credit, referrals and Reserva may be regulated where you live. You are responsible for using the app only where you are allowed to do so. These texts are information, not a licence, not legal advice and not a promise that the service is authorised in every country.',
    ],
    [
      'Limits of the service',
      'We do not collect through your contacts or with threats. Late payment affects on-network reputation until you catch up. We may pause the protocol or refuse a request if the rules of the network or the law require it. Support: soporte@quatriviumcredit.app',
    ]
  ),
  es: sections(
    [
      'Datos en este teléfono y en la red pública',
      'La frase de 24 palabras es la llave de su cuenta. Queda en este teléfono y en el respaldo que usted haga; no se escribe en la red. PIN, huella y contraseña solo desbloquean este teléfono. Las direcciones, el crédito, la reputación, las invitaciones y los bloqueos de Reserva quedan en la red pública. La foto de perfil y la del documento pueden permanecer en este teléfono; la del documento no se envía a nuestros archivos. El correo y el teléfono sirven a la cuenta y a los avisos.',
    ],
    [
      'Permisos y terceros',
      'La aplicación puede pedir cámara (documento o perfil), notificaciones (avisos de pago y de cuenta) y biometría (para desbloquear este teléfono). Los avisos pueden salir por proveedores especializados que actúan solo bajo nuestras instrucciones. Si vincula una billetera externa, rigen también las políticas de ese servicio y de su capa de conexión. No vendemos sus datos, no leemos su agenda para cobrar y no usamos su ubicación para aprobar un crédito.',
    ],
    [
      'Conservación, menores y derechos',
      'Los datos fuera de la red (correo, teléfono, registro de avisos) se guardan solo mientras la cuenta los necesite. Puede pedirnos que dejemos de avisar y que borremos las copias fuera de la red. Lo escrito en la red pública no se puede borrar. El servicio es solo para mayores de 18 años. No atendemos a menores a sabiendas. Privacidad: privacidad@quatriviumcredit.app',
    ],
    [
      'Cambios de esta política',
      'Si esta política cambia de forma relevante, la aplicación le pedirá leer y aceptar la nueva versión antes de continuar. La fecha de la versión vigente se muestra al aceptar. Versión del 3 de octubre de 2026.',
    ],
    [
      'Reserva',
      'Reserva permite bloquear USDT durante 30 días. El monto bloqueado vuelve a su cuenta al terminar el periodo. Si una provisión aparte tiene fondos, puede sumarse un rendimiento estimado de hasta el 12% anual sobre esos días. Ese rendimiento no está garantizado y puede ser cero. Reserva no es un depósito bancario, no es un plazo fijo y no es un producto de inversión. Se puede bloquear desde el nivel 10 y, en la cuenta Real, con los mismos pasos de identidad que el crédito.',
    ],
    [
      'Fondo común y donaciones',
      'El USDT que entra al fondo común permanece ahí para prestar. Aportar no es un producto que se pueda retirar. Donar es voluntario, va a la billetera del proyecto y no entra al fondo. No hay compras dentro de Google Play: el valor se mueve en la red pública.',
    ],
    [
      'Riesgos y la ley de su país',
      'USDT y las comisiones de red pueden cambiar de valor. Las transferencias en la red no se deshacen. Si pierde la frase de respaldo, esa cuenta no se reabre. Un nivel alto de crédito puede no tener fondos. Quatrivium Finance pone la aplicación; el protocolo se ejecuta en la red. El crédito, los referidos y Reserva pueden estar regulados donde usted vive. Usted es responsable de usar la aplicación solo donde le esté permitido. Estos textos informan; no son una licencia, no son asesoría legal y no prometen que el servicio esté autorizado en todos los países.',
    ],
    [
      'Límites del servicio',
      'No cobramos a través de sus contactos ni con amenazas. El retraso afecta la reputación en la red hasta ponerse al día. Podemos pausar el protocolo o rechazar una solicitud si las reglas de la red o la ley lo exigen. Atención: soporte@quatriviumcredit.app',
    ]
  ),
  zh: sections(
    [
      '本手机与公开网络上的数据',
      '24 个词是账户钥匙，留在本手机和您的备份中，不写入网络。PIN、指纹和密码只用于解锁本手机。钱包地址、信贷、声誉、邀请与储备锁定写入公开网络，任何查阅该网络的人都能看见。头像与本地证件照可留在本机；证件照不发送至我们的档案。邮箱与电话用于账户和通知。',
    ],
    [
      '权限与第三方',
      '应用可能请求相机（证件或头像）、通知（付款与账户提醒）和生物识别（解锁本机）。通知可能由仅按我们指示行事的专业服务商发送。若关联外部钱包，该钱包及其连接层适用其自身政策。我们不出售数据，不读取通讯录催收，不用定位审批信贷。',
    ],
    [
      '保存期限、未成年人与权利',
      '网络外数据（邮箱、电话、通知记录）仅在账户需要时保存。您可要求停止通知并删除网络外副本。写入公开网络的内容无法删除。服务仅限 18 岁以上。我们不会在知情情况下向未成年人提供服务。隐私：privacidad@quatriviumcredit.app',
    ],
    [
      '本政策的变更',
      '若本政策发生重大变更，应用会要求您阅读并接受新版本后方可继续。接受时会显示生效版本日期。版本日期：2026 年 10 月 3 日。',
    ],
    [
      '储备',
      '储备可将 USDT 锁定 30 天。期满后锁定金额退回账户。若另有资金池，可能就这些天数加算最高约每年 12% 的预估收益。该收益不保证，可为零。储备不是银行存款、不是定期、也不是投资产品。自 10 级起可锁定；在真实账户中须完成与信贷相同的身份步骤。',
    ],
    [
      '共同基金与捐赠',
      '进入共同基金的 USDT 留作放贷。出资不是可赎回产品。捐赠出于自愿，进入项目钱包，不进入基金。没有 Google Play 内购：价值在公开网络上流动。',
    ],
    [
      '风险与所在地法律',
      'USDT 与网络手续费可能波动。网络转账不可撤销。若丢失恢复短语，该账户无法重开。高等级可能没有资金。Quatrivium Finance 提供应用，协议在网络上执行。信贷、推荐与储备在您居住地可能受监管。您须仅在被允许的地方使用本应用。这些文本仅供说明，不是许可、不是法律意见，也不保证服务在各国均获授权。',
    ],
    [
      '服务限制',
      '我们不会通过通讯录或威胁催收。逾期会影响网络声誉，直至结清。若网络规则或法律要求，我们可暂停协议或拒绝申请。支持：soporte@quatriviumcredit.app',
    ]
  ),
  hi: sections(
    [
      'इस उपकरण और सार्वजनिक नेटवर्क पर डेटा',
      '24 शब्द खाते की कुंजी हैं। ये इस फ़ोन और आपके बैकअप में रहते हैं; नेटवर्क पर नहीं लिखे जाते। पिन, फ़िंगरप्रिंट और पासवर्ड केवल यह फ़ोन खोलते हैं। बटुआ पता, ऋण, प्रतिष्ठा, आमंत्रण और रिज़र्व लॉक सार्वजनिक नेटवर्क पर लिखे जाते हैं और जो उसे पढ़े वह देख सकता है। प्रोफ़ाइल फ़ोटो और स्थानीय पहचान फ़ोटो उपकरण पर रह सकती हैं; पहचान फ़ोटो हमारी फाइलों में नहीं जाती। ईमेल और फ़ोन खाते और सूचनाओं के लिए हैं।',
    ],
    [
      'अनुमतियाँ और तृतीय पक्ष',
      'ऐप कैमरा (दस्तावेज़ या प्रोफ़ाइल), सूचनाएँ (भुगतान और खाता) और बायोमेट्रिक्स (यह फ़ोन खोलने) माँग सकती है। सूचनाएँ केवल हमारे निर्देश पर काम करने वाले सेवा प्रदाता भेज सकते हैं। बाहरी बटुआ जोड़ने पर उस सेवा और उसके कनेक्शन की नीति भी लागू होती है। हम डेटा नहीं बेचते, वसूली के लिए संपर्क नहीं पढ़ते, स्थान से ऋण मंज़ूर नहीं करते।',
    ],
    [
      'अवधि, नाबालिग और आपके अधिकार',
      'नेटवर्क से बाहर डेटा (ईमेल, फ़ोन, सूचना अभिलेख) केवल खाते की आवश्यकता तक रखा जाता है। सूचनाएँ रोकने और बाहरी प्रतियाँ मिटाने को कह सकते हैं। सार्वजनिक नेटवर्क पर लिखा मिटता नहीं। सेवा केवल 18 वर्ष या अधिक के लिए है। हम जानबूझकर बच्चों को सेवा नहीं देते। गोपनीयता: privacidad@quatriviumcredit.app',
    ],
    [
      'इस नीति में परिवर्तन',
      'यदि नीति में महत्वपूर्ण बदलाव हो, तो ऐप जारी रखने से पहले नया संस्करण पढ़कर स्वीकार करने को कहेगी। स्वीकार करते समय प्रभावी तिथि दिखती है। संस्करण: 3 अक्टूबर 2026।',
    ],
    [
      'रिज़र्व',
      'रिज़र्व USDT को 30 दिन बाँधता है। अवधि समाप्त पर राशि खाते में लौटती है। यदि अलग निधि हो तो उन दिनों पर वार्षिक लगभग 12% तक अनुमानित प्रतिफल जुड़ सकता है। वह प्रतिफल गारंटी नहीं और शून्य हो सकता है। रिज़र्व बैंक जमा, सावधि या निवेश उत्पाद नहीं है। स्तर 10 से बाँधा जा सकता है; वास्तविक खाते में ऋण जैसी पहचान चाहिए।',
    ],
    [
      'साझा कोष और दान',
      'साझा कोष में गया USDT उधार देने रहता है। अंशदान निकाला नहीं जाता। दान स्वैच्छिक है, परियोजना बटुए में जाता है, कोष में नहीं। Google Play में खरीदारी नहीं: मूल्य सार्वजनिक नेटवर्क पर चलता है।',
    ],
    [
      'जोखिम और आपके देश का कानून',
      'USDT और नेटवर्क शुल्क बदल सकते हैं। नेटवर्क अंतरण उल्टे नहीं होते। वाक्य खोएँ तो वह खाता नहीं खुलता। ऊँचे स्तर पर धन न हो। Quatrivium Finance ऐप देती है; प्रोटोकॉल नेटवर्क पर चलता है। ऋण, आमंत्रण और रिज़र्व आपके देश में विनियमित हो सकते हैं। आप केवल जहाँ अनुमति हो वहीं ऐप उपयोग के लिए जिम्मेदार हैं। ये पाठ जानकारी हैं; लाइसेंस, कानूनी सलाह या हर देश में अनुमति का वादा नहीं।',
    ],
    [
      'सेवा की सीमाएँ',
      'संपर्कों या धमकी से वसूली नहीं। देरी नेटवर्क प्रतिष्ठा को प्रभावित करती है जब तक चालू न हों। नेटवर्क नियमों या कानून की माँग हो तो हम प्रोटोकॉल रोक या अनुरोध अस्वीकार कर सकते हैं। सहायता: soporte@quatriviumcredit.app',
    ]
  ),
  ar: sections(
    [
      'البيانات على هذا الجهاز وعلى الشبكة العامة',
      'عبارة الـ24 كلمة مفتاح حسابك. تبقى على هذا الهاتف وفي نسختك الاحتياطية؛ لا تُكتب على الشبكة. رمز PIN والبصمة وكلمة المرور تفتح هذا الهاتف فقط. عناوين المحافظ والائتمان والسمعة والدعوات وأقفال الاحتياطي تُكتب على شبكة عامة ويمكن لمن يقرأها أن يراها. قد تبقى صورة الملف وصورة الهوية المحلية على الجهاز؛ وصورة الوثيقة لا تُرسل إلى ملفاتنا. البريد والهاتف للحساب والتنبيهات.',
    ],
    [
      'الأذونات والأطراف الثالثة',
      'قد تطلب التطبيق الكاميرا (وثيقة أو ملف) والإشعارات (تنبيهات الدفع والحساب) والقياسات الحيوية (لفتح هذا الهاتف). قد تُرسل التنبيهات عبر مزوّدين متخصصين يعملون وفق تعليماتنا فقط. إذا ربطت محفظة خارجية تسري أيضاً سياسات تلك الخدمة وطبقة الاتصال. لا نبيع بياناتك ولا نقرأ جهات الاتصال للتحصيل ولا نستخدم الموقع للموافقة على ائتمان.',
    ],
    [
      'الاحتفاظ والقُصّر وحقوقك',
      'تُحفظ البيانات خارج الشبكة (البريد والهاتف وسجلات التنبيه) ما دامت الحساب تحتاجها. يمكنك طلب إيقاف التنبيهات وحذف النسخ خارج الشبكة. ما يُكتب على الشبكة العامة لا يُمحى. الخدمة لمن أتمّ 18 عاماً فقط. لا نقدّم الخدمة للقاصرين عن علم. الخصوصية: privacidad@quatriviumcredit.app',
    ],
    [
      'تغييرات هذه السياسة',
      'إذا تغيّرت هذه السياسة تغيّراً جوهرياً فستطلب منك التطبيق قراءة النسخة الجديدة وقبولها قبل المتابعة. يظهر تاريخ النسخة السارية عند القبول. نسخة 3 أكتوبر 2026.',
    ],
    [
      'الاحتياطي',
      'يتيح الاحتياطي تجميد USDT لمدة 30 يوماً. يعود المبلغ المجمّد إلى حسابك عند انتهاء المدة. إن توفّر صندوق منفصل فقد يُضاف عائد تقديري حتى 12% سنوياً لتلك الأيام. ذلك العائد غير مضمون وقد يكون صفراً. الاحتياطي ليس وديعة مصرفية ولا أجلاً ثابتاً ولا منتج استثمار. يُتاح التجميد من المستوى 10، وفي الحساب الحقيقي بعد خطوات الهوية نفسها الخاصة بالائتمان.',
    ],
    [
      'الصندوق المشترك والتبرعات',
      'يبقى USDT الذي يدخل الصندوق المشترك للإقراض. المساهمة ليست منتج سحب. التبرع اختياري ويذهب إلى محفظة المشروع ولا يدخل الصندوق. لا مشتريات داخل Google Play: القيمة تتحرك على الشبكة العامة.',
    ],
    [
      'المخاطر وقانون بلدك',
      'قد تتغيّر قيمة USDT ورسوم الشبكة. تحويلات الشبكة لا تُعكس. إن فقدت عبارة الاسترداد لا يُعاد فتح ذلك الحساب. قد لا تتوفر أموال لمستوى مرتفع. تقدّم Quatrivium Finance التطبيق؛ ويعمل البروتوكول على الشبكة. قد يخضع الائتمان والإحالات والاحتياطي للتنظيم حيث تعيش. أنت مسؤول عن استخدام التطبيق حيث يُسمح لك فقط. هذه النصوص معلومات وليست ترخيصاً ولا استشارة قانونية ولا وعداً بأن الخدمة مرخّصة في كل بلد.',
    ],
    [
      'حدود الخدمة',
      'لا نحصّل عبر جهات الاتصال ولا بالتهديد. التأخير يؤثّر في السمعة على الشبكة حتى التسوية. قد نوقف البروتوكول أو نرفض طلباً إذا اقتضت قواعد الشبكة أو القانون ذلك. الدعم: soporte@quatriviumcredit.app',
    ]
  ),
  bn: sections(
    [
      'এই যন্ত্র ও পাবলিক নেটওয়ার্কের তথ্য',
      '২৪ শব্দ অ্যাকাউন্টের চাবি। এই ফোন ও আপনার ব্যাকআপে থাকে; নেটওয়ার্কে লেখা হয় না। পিন, আঙুলের ছাপ ও পাসওয়ার্ড শুধু এই ফোন খোলে। ওয়ালেট ঠিকানা, ঋণ, সুনাম, আমন্ত্রণ ও রিজার্ভ লক পাবলিক নেটওয়ার্কে লেখা হয় এবং যিনি পড়েন তিনি দেখতে পারেন। প্রোফাইল ছবি ও স্থানীয় পরিচয় ছবি যন্ত্রে থাকতে পারে; পরিচয় ছবি আমাদের ফাইলে যায় না। ইমেইল ও ফোন অ্যাকাউন্ট ও নোটিশের জন্য।',
    ],
    [
      'অনুমতি ও তৃতীয় পক্ষ',
      'অ্যাপ ক্যামেরা (নথি বা প্রোফাইল), নোটিফিকেশন (পেমেন্ট ও অ্যাকাউন্ট) এবং বায়োমেট্রিক্স (এই ফোন খুলতে) চাইতে পারে। নোটিশ কেবল আমাদের নির্দেশে কাজ করা বিশেষ পরিষেবা পাঠাতে পারে। বাইরের ওয়ালেট যুক্ত করলে সেই সেবা ও সংযোগ স্তরের নীতিও প্রযোজ্য। আমরা ডেটা বেচি না, আদায়ে কন্টাক্ট পড়ি না, অবস্থান দিয়ে ঋণ পাস করি না।',
    ],
    [
      'সংরক্ষণ, নাবালক ও আপনার অধিকার',
      'নেটওয়ার্কের বাইরের তথ্য (ইমেইল, ফোন, নোটিশ রেকর্ড) অ্যাকাউন্টের প্রয়োজন পর্যন্ত রাখা হয়। নোটিশ বন্ধ ও বাইরের কপি মুছতে বলতে পারেন। পাবলিক নেটওয়ার্কে লেখা মুছে যায় না। সেবা শুধু ১৮ বা তার বেশি। আমরা জেনেশুনে শিশুদের সেবা দিই না। গোপনীয়তা: privacidad@quatriviumcredit.app',
    ],
    [
      'এই নীতির পরিবর্তন',
      'নীতি গুরুত্বপূর্ণভাবে বদলালে চালিয়ে যাওয়ার আগে নতুন সংস্করণ পড়ে গ্রহণ করতে হবে। গ্রহণের সময় কার্যকর তারিখ দেখা যায়। সংস্করণ: ৩ অক্টোবর ২০২৬।',
    ],
    [
      'রিজার্ভ',
      'রিজার্ভ USDT ৩০ দিন আটকায়। মেয়াদ শেষে অর্থ অ্যাকাউন্টে ফেরে। আলাদা তহবিল থাকলে সেই দিনগুলিতে বার্ষিক সর্বোচ্চ প্রায় ১২% অনুমানিত আয় যোগ হতে পারে। সেই আয় নিশ্চিত নয়, শূন্য হতে পারে। রিজার্ভ ব্যাংক আমানত, মেয়াদি বা বিনিয়োগ পণ্য নয়। স্তর ১০ থেকে আটকানো যায়; আসল অ্যাকাউন্টে ঋণের মতো পরিচয় ধাপ লাগে।',
    ],
    [
      'সাধারণ তহবিল ও দান',
      'সাধারণ তহবিলে যাওয়া USDT ধার দিতে থাকে। অবদান তোলা যায় না। দান স্বেচ্ছায়, প্রকল্প ওয়ালেটে যায়, তহবিলে নয়। Google Play কেনা নেই: মূল্য পাবলিক নেটওয়ার্কে চলে।',
    ],
    [
      'ঝুঁকি ও আপনার দেশের আইন',
      'USDT ও নেটওয়ার্ক ফি বদলাতে পারে। নেটওয়ার্ক স্থানান্তর ফেরে না। বাক্য হারালে সেই অ্যাকাউন্ট খোলে না। উচ্চ স্তরে তহবিল নাও থাকতে পারে। Quatrivium Finance অ্যাপ দেয়; প্রোটোকল নেটওয়ার্কে চলে। ঋণ, আমন্ত্রণ ও রিজার্ভ আপনার দেশে নিয়ন্ত্রিত হতে পারে। আপনি শুধু যেখানে অনুমতি আছে সেখানে ব্যবহারের জন্য দায়ী। এগুলো তথ্য; লাইসেন্স, আইনি পরামর্শ বা সব দেশে অনুমতির প্রতিশ্রুতি নয়।',
    ],
    [
      'সেবার সীমা',
      'কন্টাক্ট বা হুমকি দিয়ে আদায় নেই। দেরি নেটওয়ার্ক সুনাম ক্ষতিগ্রস্ত করে যতক্ষণ নিয়মিত না হন। নেটওয়ার্ক নিয়ম বা আইন চাইলে আমরা প্রোটোকল থামাতে বা আবেদন প্রত্যাখ্যান করতে পারি। সহায়তা: soporte@quatriviumcredit.app',
    ]
  ),
  pt: sections(
    [
      'Dados neste telefone e na rede pública',
      'A frase de 24 palavras é a chave da conta. Fica neste telefone e no respaldo que fizer; não se escreve na rede. PIN, impressão e palavra-passe só desbloqueiam este telefone. Endereços, crédito, reputação, convites e bloqueios da Reserva ficam numa rede pública e pode vê-los quem a consultar. A foto de perfil e a foto local de identidade podem permanecer neste telefone; a do documento não vai para os nossos ficheiros. O correio e o telefone servem a conta e os avisos.',
    ],
    [
      'Permissões e terceiros',
      'A aplicação pode pedir câmara (documento ou perfil), notificações (avisos de pagamento e de conta) e biometria (para desbloquear este telefone). Os avisos podem sair por prestadores especializados que atuam só sob as nossas instruções. Se vincular uma carteira externa, aplicam-se também as políticas desse serviço e da respetiva camada de ligação. Não vendemos os seus dados, não lemos a agenda para cobrar e não usamos a localização para aprovar crédito.',
    ],
    [
      'Conservação, menores e direitos',
      'Os dados fora da rede (correio, telefone, registo de avisos) guardam-se só enquanto a conta os precisar. Pode pedir que deixemos de avisar e que apaguemos as cópias fora da rede. O que está na rede pública não se apaga. O serviço é só para maiores de 18 anos. Não atendemos menores de propósito. Privacidade: privacidad@quatriviumcredit.app',
    ],
    [
      'Alterações desta política',
      'Se esta política mudar de forma relevante, a aplicação pedirá que leia e aceite a nova versão antes de continuar. A data da versão em vigor aparece ao aceitar. Versão de 3 de outubro de 2026.',
    ],
    [
      'Reserva',
      'A Reserva permite bloquear USDT durante 30 dias. O montante bloqueado volta à conta no fim do período. Se uma provisão à parte tiver fundos, pode somar-se um rendimento estimado de até 12% ao ano sobre esses dias. Esse rendimento não é garantido e pode ser zero. A Reserva não é depósito bancário, não é prazo fixo e não é um produto de investimento. Pode bloquear-se a partir do nível 10 e, na Conta Real, com os mesmos passos de identidade do crédito.',
    ],
    [
      'Fundo comum e donativos',
      'O USDT que entra no fundo comum permanece para emprestar. Aportar não é um produto de levantamento. Doar é voluntário, vai para a carteira do projeto e não entra no fundo. Não há compras na Google Play: o valor move-se na rede pública.',
    ],
    [
      'Riscos e a lei do seu país',
      'USDT e as comissões de rede podem mudar de valor. As transferências na rede não se desfazem. Se perder a frase de recuperação, essa conta não se reabre. Um nível alto pode não ter fundos. A Quatrivium Finance oferece a aplicação; o protocolo corre na rede. O crédito, as indicações e a Reserva podem estar regulados onde vive. É responsável por usar a aplicação só onde lhe for permitido. Estes textos informam; não são licença, aconselhamento jurídico nem promessa de autorização em todos os países.',
    ],
    [
      'Limites do serviço',
      'Não cobramos pelos contactos nem com ameaças. O atraso afeta a reputação na rede até regularizar. Podemos pausar o protocolo ou recusar um pedido se as regras da rede ou a lei o exigirem. Apoio: soporte@quatriviumcredit.app',
    ]
  ),
  ru: sections(
    [
      'Данные на устройстве и в открытой сети',
      'Фраза из 24 слов — ключ к счёту. Она на этом телефоне и в вашей копии, не в сети. PIN, отпечаток и пароль только разблокируют этот телефон. Адреса кошельков, кредит, репутация, приглашения и блокировки Резерва записываются в открытой сети и видны любому, кто её читает. Фото профиля и локальное фото документа могут остаться на устройстве; фото документа в наши файлы не отправляется. Почта и телефон нужны для счёта и уведомлений.',
    ],
    [
      'Разрешения и третьи лица',
      'Приложение может запросить камеру (документ или профиль), уведомления (платежи и счёт) и биометрию (чтобы разблокировать этот телефон). Уведомления могут отправлять специализированные поставщики только по нашим указаниям. Если вы привязываете внешний кошелёк, действуют также политики этого сервиса и слоя подключения. Мы не продаём данные, не читаем контакты для взыскания и не используем геолокацию для одобрения кредита.',
    ],
    [
      'Срок хранения, несовершеннолетние и ваши права',
      'Данные вне сети (почта, телефон, журнал уведомлений) хранятся только пока они нужны счёту. Вы можете просить прекратить уведомления и удалить копии вне сети. Записанное в открытой сети стереть нельзя. Сервис только для лиц 18 лет и старше. Мы сознательно не обслуживаем детей. Конфиденциальность: privacidad@quatriviumcredit.app',
    ],
    [
      'Изменения этой политики',
      'Если политика существенно изменится, приложение попросит прочитать и принять новую версию, прежде чем продолжить. Дата действующей версии показывается при принятии. Версия от 3 октября 2026 года.',
    ],
    [
      'Резерв',
      'Резерв позволяет заблокировать USDT на 30 дней. Заблокированная сумма возвращается на счёт по окончании срока. Если отдельное резервное обеспечение имеет средства, за эти дни может начислиться оценочная доходность до 12% годовых. Она не гарантирована и может быть нулевой. Резерв — не банковский вклад, не срочный депозит и не инвестиционный продукт. Блокировка доступна с 10-го уровня и, в реальном счёте, после тех же шагов идентификации, что и кредит.',
    ],
    [
      'Общий фонд и пожертвования',
      'USDT, поступивший в общий фонд, остаётся там для выдачи. Взнос нельзя вывести. Пожертвование добровольно, идёт на кошелёк проекта и в фонд не входит. Покупок в Google Play нет: стоимость движется в открытой сети.',
    ],
    [
      'Риски и закон вашей страны',
      'USDT и сетевые комиссии могут менять стоимость. Переводы в сети необратимы. Потеряв фразу восстановления, вы не откроете этот счёт. На высоком уровне может не быть средств. Quatrivium Finance даёт приложение; протокол исполняется в сети. Кредит, приглашения и Резерв могут регулироваться там, где вы живёте. Вы отвечаете за использование приложения только там, где это разрешено. Эти тексты — информация, не лицензия, не юридическая консультация и не обещание разрешения во всех странах.',
    ],
    [
      'Ограничения сервиса',
      'Мы не взыскиваем через контакты и не угрожаем. Просрочка влияет на сетевую репутацию, пока вы не погасите. Мы можем приостановить протокол или отказать в заявке, если этого требуют правила сети или закон. Поддержка: soporte@quatriviumcredit.app',
    ]
  ),
  ur: sections(
    [
      'اس آلے اور عوامی نیٹ ورک پر ڈیٹا',
      '24 الفاظ اکاؤنٹ کی کنجی ہیں۔ اس فون اور آپ کے بیک اپ میں رہتے ہیں؛ نیٹ ورک پر نہیں لکھتے۔ پن، نشان اور پاس ورڈ صرف یہ فون کھولتے ہیں۔ والیٹ پتے، قرض، شہرت، دعوتیں اور ریزرو لاک عوامی نیٹ ورک پر لکھے جاتے ہیں اور جو پڑھے وہ دیکھ سکتا ہے۔ پروفائل تصویر اور مقامی شناختی تصویر آلے پر رہ سکتی ہیں؛ شناختی تصویر ہماری فائلوں میں نہیں جاتی۔ ای میل اور فون اکاؤنٹ اور نوٹس کے لیے ہیں۔',
    ],
    [
      'اجازتیں اور تیسرے فریق',
      'ایپ کیمرہ (دستاویز یا پروفائل)، اطلاعات (ادائیگی اور اکاؤنٹ) اور بایومیٹرکس (یہ فون کھولنے) مانگ سکتی ہے۔ نوٹس صرف ہماری ہدایت پر کام کرنے والے خدمات بھیج سکتے ہیں۔ بیرونی والیٹ منسلک کرنے پر اس خدمت اور اس کے کنکشن کی پالیسی بھی لاگو ہوتی ہے۔ ہم ڈیٹا نہیں بیچتے، وصولی کے لیے رابطے نہیں پڑھتے، مقام سے قرض منظور نہیں کرتے۔',
    ],
    [
      'مدت، نابالغ اور آپ کے حقوق',
      'نیٹ ورک سے باہر ڈیٹا (ای میل، فون، نوٹس ریکارڈ) صرف اکاؤنٹ کی ضرورت تک رکھا جاتا ہے۔ نوٹس روکنے اور بیرونی نقول مٹانے کو کہہ سکتے ہیں۔ عوامی نیٹ ورک پر لکھا مٹتا نہیں۔ خدمت صرف 18 سال یا زیادہ کے لیے ہے۔ ہم جان بوجھ کر بچوں کو خدمت نہیں دیتے۔ رازداری: privacidad@quatriviumcredit.app',
    ],
    [
      'اس پالیسی میں تبدیلی',
      'اگر پالیسی میں اہم تبدیلی ہو تو ایپ جاری رکھنے سے پہلے نیا نسخہ پڑھ کر قبول کرنے کو کہے گی۔ قبول کرتے وقت مؤثر تاریخ دکھتی ہے۔ نسخہ: 3 اکتوبر 2026۔',
    ],
    [
      'ریزرو',
      'ریزرو USDT کو 30 دن مقفل کرتا ہے۔ مدت ختم پر رقم اکاؤنٹ میں لوٹتی ہے۔ اگر الگ برتن میں وسائل ہوں تو ان دنوں پر سالانہ تقریباً 12% تک تخمینی منافع لگ سکتا ہے۔ وہ منافع ضمانت نہیں اور صفر ہو سکتا ہے۔ ریزرو بینک جمع، میعادی یا سرمایہ کاری مصنوع نہیں۔ درجہ 10 سے مقفل ہو سکتا ہے؛ حقیقی اکاؤنٹ میں قرض جیسے شناخت کے مراحل درکار ہیں۔',
    ],
    [
      'مشترکہ فنڈ اور عطیات',
      'مشترکہ فنڈ میں گیا USDT قرض دینے رہتا ہے۔ حصہ نہیں نکالا جاتا۔ عطیہ رضاکارانہ ہے، منصوبے کے والیٹ میں جاتا ہے، فنڈ میں نہیں۔ Google Play خرید نہیں: قدر عوامی نیٹ ورک پر چلتی ہے۔',
    ],
    [
      'خطرات اور آپ کے ملک کا قانون',
      'USDT اور نیٹ ورک فیس بدل سکتی ہیں۔ نیٹ ورک ترسیل واپس نہیں ہوتیں۔ جملہ کھوئیں تو وہ اکاؤنٹ نہیں کھلتا۔ اونچے درجے پر فنڈ نہ ہو۔ Quatrivium Finance ایپ دیتی ہے؛ پروٹوکول نیٹ ورک پر چلتا ہے۔ قرض، دعوتیں اور ریزرو آپ کے ملک میں زیر ضابطہ ہو سکتے ہیں۔ آپ صرف جہاں اجازت ہو وہاں استعمال کے ذمہ دار ہیں۔ یہ متن معلومات ہے؛ لائسنس، قانونی مشورہ یا ہر ملک میں اجازت کا وعدہ نہیں۔',
    ],
    [
      'خدمت کی حدیں',
      'رابطوں یا دھمکی سے وصولی نہیں۔ تاخیر نیٹ ورک شہرت کو متاثر کرتی ہے جب تک حساب صاف نہ ہو۔ نیٹ ورک قواعد یا قانون مانگے تو ہم پروٹوکول روک یا درخواست مسترد کر سکتے ہیں۔ مدد: soporte@quatriviumcredit.app',
    ]
  ),
  id: sections(
    [
      'Data di perangkat ini dan di jaringan publik',
      'Frasa 24 kata adalah kunci akun. Tetap di ponsel ini dan di cadangan Anda; tidak ditulis di jaringan. PIN, sidik jari, dan kata sandi hanya membuka ponsel ini. Alamat dompet, kredit, reputasi, undangan, dan kunci Cadangan tertulis di jaringan publik dan dapat dilihat siapa pun yang membacanya. Foto profil dan foto identitas lokal dapat tetap di perangkat; foto identitas tidak dikirim ke berkas kami. Email dan telepon untuk akun dan pemberitahuan.',
    ],
    [
      'Izin dan pihak ketiga',
      'Aplikasi dapat meminta kamera (dokumen atau profil), notifikasi (peringatan pembayaran dan akun), dan biometrik (untuk membuka ponsel ini). Pemberitahuan dapat dikirim oleh penyedia khusus yang bertindak hanya atas instruksi kami. Jika Anda menautkan dompet eksternal, kebijakan layanan itu dan lapisan koneksinya juga berlaku. Kami tidak menjual data, tidak membaca kontak untuk menagih, dan tidak memakai lokasi untuk menyetujui kredit.',
    ],
    [
      'Penyimpanan, anak, dan hak Anda',
      'Data di luar jaringan (email, telepon, catatan pemberitahuan) disimpan hanya selama akun memerlukannya. Anda dapat meminta kami menghentikan pemberitahuan dan menghapus salinan di luar jaringan. Tulisan di jaringan publik tidak dapat dihapus. Layanan hanya untuk usia 18 tahun ke atas. Kami tidak dengan sadar melayani anak. Privasi: privacidad@quatriviumcredit.app',
    ],
    [
      'Perubahan kebijakan ini',
      'Jika kebijakan ini berubah secara material, aplikasi akan meminta Anda membaca dan menerima versi baru sebelum lanjut. Tanggal versi yang berlaku tampil saat menerima. Versi 3 Oktober 2026.',
    ],
    [
      'Cadangan',
      'Cadangan memungkinkan mengunci USDT selama 30 hari. Jumlah terkunci kembali ke akun saat periode berakhir. Jika provisi terpisah punya dana, imbal hasil perkiraan hingga 12% setahun dapat ditambahkan untuk hari-hari itu. Imbal hasil itu tidak dijamin dan bisa nol. Cadangan bukan simpanan bank, bukan deposito berjangka, dan bukan produk investasi. Penguncian tersedia dari tingkat 10 dan, di Akun Nyata, setelah langkah identitas yang sama dengan kredit.',
    ],
    [
      'Dana bersama dan donasi',
      'USDT yang masuk dana bersama tetap untuk dipinjamkan. Kontribusi bukan produk yang dapat ditarik. Donasi sukarela, ke dompet proyek, dan tidak masuk dana. Tidak ada pembelian di Google Play: nilai bergerak di jaringan publik.',
    ],
    [
      'Risiko dan hukum negara Anda',
      'USDT dan biaya jaringan dapat berubah nilainya. Transfer jaringan tidak dapat dibatalkan. Jika frasa pemulihan hilang, akun itu tidak dapat dibuka. Tingkat tinggi mungkin tidak berdana. Quatrivium Finance menyediakan aplikasi; protokol berjalan di jaringan. Kredit, undangan, dan Cadangan dapat diatur di tempat Anda tinggal. Anda bertanggung jawab memakai aplikasi hanya di mana diizinkan. Teks ini informasi, bukan lisensi, bukan nasihat hukum, dan bukan janji izin di setiap negara.',
    ],
    [
      'Batas layanan',
      'Kami tidak menagih lewat kontak atau ancaman. Keterlambatan memengaruhi reputasi di jaringan hingga lunas. Kami dapat menjeda protokol atau menolak pengajuan jika aturan jaringan atau hukum menuntutnya. Dukungan: soporte@quatriviumcredit.app',
    ]
  ),
  fr: sections(
    [
      'Données sur cet appareil et sur le réseau public',
      'La phrase de 24 mots est la clé de votre compte. Elle reste sur ce téléphone et dans la copie que vous faites ; elle n’est pas écrite sur le réseau. Le code PIN, l’empreinte et le mot de passe ne font que déverrouiller ce téléphone. Les adresses, le crédit, la réputation, les invitations et les blocages de Réserve sont inscrits sur un réseau public et visibles par quiconque le consulte. La photo de profil et la photo d’identité locale peuvent rester sur ce téléphone ; celle du document n’est pas envoyée dans nos dossiers. L’e-mail et le téléphone servent le compte et les avis.',
    ],
    [
      'Autorisations et tiers',
      'L’application peut demander la caméra (document ou profil), les notifications (alertes de paiement et de compte) et la biométrie (pour déverrouiller ce téléphone). Les avis peuvent être envoyés par des prestataires spécialisés agissant uniquement sur nos instructions. Si vous liez un portefeuille externe, les politiques de ce service et de sa couche de connexion s’appliquent aussi. Nous ne vendons pas vos données, ne lisons pas l’agenda pour recouvrer et n’utilisons pas la localisation pour accorder un crédit.',
    ],
    [
      'Conservation, mineurs et vos droits',
      'Les données hors réseau (e-mail, téléphone, registres d’avis) sont conservées seulement tant que le compte en a besoin. Vous pouvez demander l’arrêt des avis et la suppression des copies hors réseau. Ce qui est écrit sur le réseau public ne s’efface pas. Le service est réservé aux 18 ans et plus. Nous ne servons pas sciemment les enfants. Confidentialité : privacidad@quatriviumcredit.app',
    ],
    [
      'Modifications de cette politique',
      'Si cette politique change de façon substantielle, l’application vous demandera de lire et d’accepter la nouvelle version avant de continuer. La date de la version en vigueur s’affiche à l’acceptation. Version du 3 octobre 2026.',
    ],
    [
      'Réserve',
      'Réserve permet de bloquer des USDT pendant 30 jours. Le montant bloqué revient sur le compte à la fin de la période. Si une provision distincte a des fonds, un rendement estimé jusqu’à 12 % par an peut s’ajouter pour ces jours. Ce rendement n’est pas garanti et peut être nul. Réserve n’est ni un dépôt bancaire, ni un terme fixe, ni un produit d’investissement. Le blocage est possible à partir du niveau 10 et, sur le compte réel, après les mêmes étapes d’identité que le crédit.',
    ],
    [
      'Fonds commun et dons',
      'Les USDT versés au fonds commun y restent pour prêter. Un apport n’est pas un produit de retrait. Le don est volontaire, va au portefeuille du projet et n’entre pas dans le fonds. Pas d’achats Google Play : la valeur circule sur le réseau public.',
    ],
    [
      'Risques et le droit de votre pays',
      'L’USDT et les frais de réseau peuvent changer de valeur. Les virements sur le réseau sont irréversibles. Sans la phrase de reprise, ce compte ne se rouvre pas. Un niveau élevé peut manquer de fonds. Quatrivium Finance fournit l’application ; le protocole s’exécute sur le réseau. Le crédit, les parrainages et Réserve peuvent être réglementés là où vous vivez. Vous êtes responsable d’utiliser l’application seulement là où cela vous est permis. Ces textes informent ; ils ne sont ni une licence, ni un conseil juridique, ni une promesse d’autorisation dans tous les pays.',
    ],
    [
      'Limites du service',
      'Nous ne recouvrons pas par vos contacts ni par menaces. Le retard affecte la réputation sur le réseau jusqu’à régularisation. Nous pouvons suspendre le protocole ou refuser une demande si les règles du réseau ou la loi l’exigent. Assistance : soporte@quatriviumcredit.app',
    ]
  ),
  ja: sections(
    [
      'この端末と公開ネットワーク上のデータ',
      '24語は口座の鍵です。この携帯電話とお客様の控えにあり、ネットワークには書きません。PIN・指紋・パスワードはこの携帯電話の解除だけに使います。ウォレット住所、与信、評価、招待、準備のロックは公開ネットワークに記録され、閲覧した人が見られます。プロフィール写真と端末内の身分証写真は端末に残ることがあります。身分証写真は当社のファイルには送りません。メールと電話は口座と通知に用います。',
    ],
    [
      '権限と第三者',
      'アプリはカメラ（書類またはプロフィール）、通知（支払と口座）、生体認証（この端末の解除）を求めることがあります。通知は当社の指示のみで動く専門事業者から送られることがあります。外部ウォレットを連携すると、そのサービスと接続層の方針も適用されます。データを販売せず、取立てに連絡先を使わず、位置情報で与信を承認しません。',
    ],
    [
      '保存期間、未成年、お客様の権利',
      'ネットワーク外のデータ（メール、電話、通知記録）は口座が必要とする間だけ保管します。通知停止とネットワーク外コピーの削除を依頼できます。公開ネットワーク上の記録は消せません。サービスは18歳以上のみです。児童に故意に提供しません。プライバシー: privacidad@quatriviumcredit.app',
    ],
    [
      '本方針の変更',
      '本方針が実質的に変わる場合、続行前に新しい版を読んで同意するよう求めます。同意時に施行日が表示されます。2026年10月3日版。',
    ],
    [
      '準備',
      '準備は USDT を30日間ロックできます。期間終了後、ロック額は口座に戻ります。別ポットに資金があれば、その日数につき年率最大約12%の見積収益が加算されることがあります。その収益は保証されず、ゼロになり得ます。準備は銀行預金でも定期でも投資商品でもありません。ロックは等級10から、本番口座では与信と同じ本人確認の後に利用できます。',
    ],
    [
      '共同基金と寄付',
      '共同基金に入った USDT は貸付け用に残ります。拠出は引出商品ではありません。寄付は任意でプロジェクトウォレットへ行き、基金には入りません。Google Play 内課金はありません。価値は公開ネットワーク上で動きます。',
    ],
    [
      'リスクとお住まいの国の法令',
      'USDT とネットワーク手数料は変動し得ます。ネットワーク送金は取り消せません。復旧フレーズを失うとその口座は再開できません。高い等級に資金が無いことがあります。Quatrivium Finance がアプリを提供し、プロトコルはネットワーク上で実行されます。与信、紹介、準備は居住地で規制されることがあります。許可された場所でのみ利用する責任はお客様にあります。本文は説明であり、許諾でも法律助言でも、すべての国で認可されているという約束でもありません。',
    ],
    [
      'サービスの限界',
      '連絡先や脅迫による取立てはありません。遅延は完済までネットワーク上の評価に影響します。ネットワーク規則または法令が求める場合、プロトコルを停止し、申込を拒否することがあります。サポート: soporte@quatriviumcredit.app',
    ]
  ),
  de: sections(
    [
      'Daten auf diesem Gerät und im öffentlichen Netz',
      'Die 24 Wörter sind der Schlüssel zu Ihrem Konto. Sie bleiben auf diesem Telefon und in Ihrer Sicherung, nicht im Netz. PIN, Fingerabdruck und Passwort entsperren nur dieses Telefon. Wallet-Adressen, Kredit, Ruf, Einladungen und Reserve-Sperren stehen in einem öffentlichen Netz und sind für jeden lesbar, der dieses Netz einsieht. Profilfoto und lokales Ausweisfoto können auf diesem Telefon bleiben; das Ausweisfoto geht nicht in unsere Akten. E-Mail und Telefon dienen Konto und Hinweisen.',
    ],
    [
      'Berechtigungen und Dritte',
      'Die App kann Kamera (Dokument oder Profil), Mitteilungen (Zahlungs- und Kontohinweise) und Biometrie (zum Entsperren dieses Telefons) anfordern. Hinweise können über spezialisierte Anbieter gehen, die nur nach unseren Weisungen handeln. Wenn Sie eine externe Wallet verbinden, gelten auch deren Richtlinien und die der Verbindungsschicht. Wir verkaufen Ihre Daten nicht, lesen keine Kontakte zum Einzug und nutzen keinen Standort zur Kreditfreigabe.',
    ],
    [
      'Aufbewahrung, Minderjährige und Ihre Rechte',
      'Daten außerhalb des Netzes (E-Mail, Telefon, Hinweisprotokolle) werden nur gespeichert, solange das Konto sie braucht. Sie können das Einstellen der Hinweise und das Löschen der Kopien außerhalb des Netzes verlangen. Im öffentlichen Netz Geschriebenes lässt sich nicht löschen. Der Dienst ist nur für Personen ab 18 Jahren. Wir bedienen Minderjährige nicht wissentlich. Datenschutz: privacidad@quatriviumcredit.app',
    ],
    [
      'Änderungen dieser Richtlinie',
      'Ändert sich diese Richtlinie wesentlich, fordert die App Sie auf, die neue Fassung zu lesen und anzunehmen, bevor Sie fortfahren. Das Datum der geltenden Fassung erscheint bei der Annahme. Fassung vom 3. Oktober 2026.',
    ],
    [
      'Reserve',
      'Reserve erlaubt, USDT 30 Tage zu sperren. Der gesperrte Betrag kehrt am Periodenende auf Ihr Konto zurück. Verfügt eine gesonderte Rückstellung über Mittel, kann für diese Tage eine geschätzte Rendite von bis zu 12 % jährlich hinzukommen. Diese Rendite ist nicht garantiert und kann null sein. Reserve ist keine Bankeinlage, kein Festgeld und kein Anlageprodukt. Sperren ist ab Stufe 10 möglich und, im Echtkonto, nach denselben Identitäts schritten wie der Kredit.',
    ],
    [
      'Gemeinsamer Fonds und Zuwendungen',
      'USDT im gemeinsamen Fonds bleibt dort zum Verleihen. Ein Beitrag ist kein Auszahlungsprodukt. Zuwendungen sind freiwillig, gehen an die Projekt-Wallet und fließen nicht in den Fonds. Keine Käufe über Google Play: der Wert bewegt sich im öffentlichen Netz.',
    ],
    [
      'Risiken und das Recht Ihres Landes',
      'USDT und Netzgebühren können im Wert schwanken. Überweisungen im Netz sind unumkehrbar. Ohne Wiederherstellungsphrase öffnet sich dieses Konto nicht wieder. Eine hohe Stufe kann ohne Mittel sein. Quatrivium Finance stellt die Anwendung; das Protokoll läuft im Netz. Kredit, Empfehlungen und Reserve können dort, wo Sie leben, reguliert sein. Sie sind dafür verantwortlich, die App nur dort zu nutzen, wo es Ihnen erlaubt ist. Diese Texte informieren; sie sind keine Lizenz, keine Rechtsberatung und kein Versprechen, dass der Dienst in jedem Land zugelassen ist.',
    ],
    [
      'Grenzen des Dienstes',
      'Wir ziehen nicht über Kontakte ein und drohen nicht. Verspätung beeinträchtigt den Ruf im Netz, bis Sie aktuell sind. Wir können das Protokoll anhalten oder einen Antrag ablehnen, wenn Netzregeln oder das Recht es verlangen. Support: soporte@quatriviumcredit.app',
    ]
  ),
  ko: sections(
    [
      '이 기기와 공개 네트워크의 데이터',
      '24단어는 계정의 열쇠입니다. 이 휴대폰과 귀하의 백업에 있으며 네트워크에는 기록되지 않습니다. PIN, 지문, 비밀번호는 이 휴대폰만 잠금 해제합니다. 지갑 주소, 신용, 평판, 초대, 준비금 잠금은 공개 네트워크에 기록되며 그 네트워크를 읽는 누구나 볼 수 있습니다. 프로필 사진과 로컬 신분증 사진은 기기에 남을 수 있습니다. 신분증 사진은 당사 파일로 보내지 않습니다. 이메일과 전화는 계정과 알림에 쓰입니다.',
    ],
    [
      '권한과 제3자',
      '앱은 카메라(서류 또는 프로필), 알림(결제 및 계정), 생체 인식(이 휴대폰 잠금 해제)을 요청할 수 있습니다. 알림은 당사 지시에만 따르는 전문 제공자가 보낼 수 있습니다. 외부 지갑을 연결하면 해당 서비스와 연결 계층의 정책도 적용됩니다. 데이터를 팔지 않고, 추심을 위해 연락처를 읽지 않으며, 위치로 신용을 승인하지 않습니다.',
    ],
    [
      '보관, 미성년자, 귀하의 권리',
      '네트워크 밖 데이터(이메일, 전화, 알림 기록)는 계정에 필요한 동안만 보관합니다. 알림 중단과 네트워크 밖 사본 삭제를 요청할 수 있습니다. 공개 네트워크에 적힌 것은 지울 수 없습니다. 서비스는 만 18세 이상만 이용합니다. 아동에게 고의로 서비스를 제공하지 않습니다. 개인정보: privacidad@quatriviumcredit.app',
    ],
    [
      '이 방침의 변경',
      '이 방침이 실질적으로 바뀌면 앱은 계속하기 전에 새 버전을 읽고 수락하도록 요청합니다. 수락 시 시행 버전의 날짜가 표시됩니다. 2026년 10월 3일 버전.',
    ],
    [
      '준비금',
      '준비금은 USDT를 30일 잠글 수 있습니다. 기간이 끝나면 잠긴 금액이 계정으로 돌아갑니다. 별도 자금이 있으면 그 일수에 대해 연 최대 약 12%의 추정 수익이 더해질 수 있습니다. 그 수익은 보장되지 않으며 0일 수 있습니다. 준비금은 은행 예금, 정기, 투자 상품이 아닙니다. 잠금은 10등급부터, 실제 계정에서는 신용과 같은 신원 단계 후에 가능합니다.',
    ],
    [
      '공동 기금과 기부',
      '공동 기금에 들어간 USDT는 대출용으로 남습니다. 출자는 인출 상품이 아닙니다. 기부는 자발적이며 프로젝트 지갑으로 가고 기금에 들어가지 않습니다. Google Play 인앱 구매는 없습니다. 가치는 공개 네트워크에서 움직입니다.',
    ],
    [
      '위험과 거주 국가의 법',
      'USDT와 네트워크 수수료는 가치가 변할 수 있습니다. 네트워크 이체는 되돌릴 수 없습니다. 복구 구문을 잃으면 그 계정을 다시 열 수 없습니다. 높은 등급에 자금이 없을 수 있습니다. Quatrivium Finance가 앱을 제공하고 프로토콜은 네트워크에서 실행됩니다. 신용, 추천, 준비금은 거주 국가에서 규제될 수 있습니다. 허용된 곳에서만 앱을 사용할 책임은 귀하에게 있습니다. 이 문구는 정보이며 허가, 법률 자문, 모든 국가에서 인가되었다는 약속이 아닙니다.',
    ],
    [
      '서비스의 한계',
      '연락처나 위협으로 추심하지 않습니다. 연체는 정산될 때까지 네트워크 평판에 영향을 줍니다. 네트워크 규칙이나 법이 요구하면 프로토콜을 일시 중지하거나 신청을 거부할 수 있습니다. 지원: soporte@quatriviumcredit.app',
    ]
  ),
  tr: sections(
    [
      'Bu cihazdaki ve kamuya açık ağdaki veriler',
      '24 sözcük hesabınızın anahtarıdır. Bu telefonda ve sizin yedeğinizde kalır; ağa yazılmaz. PIN, parmak izi ve parola yalnızca bu telefonu açar. Cüzdan adresleri, kredi, itibar, davetler ve Rezerv kilitleri kamuya açık ağa yazılır ve o ağı okuyan herkes görebilir. Profil fotoğrafı ve yerel kimlik fotoğrafı cihazda kalabilir; kimlik fotoğrafı dosyalarımıza gönderilmez. E-posta ve telefon hesap ve bildirimler içindir.',
    ],
    [
      'İzinler ve üçüncü taraflar',
      'Uygulama kamera (belge veya profil), bildirimler (ödeme ve hesap uyarıları) ve biyometri (bu telefonu açmak) isteyebilir. Bildirimler yalnızca talimatlarımızla hareket eden uzman sağlayıcılarca gönderilebilir. Harici bir cüzdan bağlarsanız o hizmetin ve bağlantı katmanının politikaları da uygulanır. Verilerinizi satmayız, tahsilat için rehberi okumayız, konumla kredi onaylamayız.',
    ],
    [
      'Saklama, çocuklar ve haklarınız',
      'Ağ dışı veriler (e-posta, telefon, bildirim kayıtları) yalnızca hesap ihtiyaç duyduğu sürece tutulur. Bildirimleri durdurmamızı ve ağ dışı kopyaları silmemizi isteyebilirsiniz. Kamuya açık ağa yazılan silinmez. Hizmet yalnızca 18 yaş ve üzeri içindir. Çocuklara bilerek hizmet vermeyiz. Gizlilik: privacidad@quatriviumcredit.app',
    ],
    [
      'Bu politikanın değişiklikleri',
      'Bu politika esaslı değişirse uygulama devam etmeden önce yeni sürümü okuyup kabul etmenizi ister. Yürürlükteki sürümün tarihi kabulde gösterilir. 3 Ekim 2026 sürümü.',
    ],
    [
      'Rezerv',
      'Rezerv, USDT’yi 30 gün kilitlemenizi sağlar. Kilitli tutar dönem bitince hesabınıza döner. Ayrı bir karşılıkta kaynak varsa o günler için yıllık en fazla yaklaşık %12 tahmini getiri eklenebilir. Bu getiri garanti değildir ve sıfır olabilir. Rezerv banka mevduatı, vadeli hesap veya yatırım ürünü değildir. Kilitleme düzey 10’dan itibaren ve Gerçek hesapta krediyle aynı kimlik adımlarından sonra yapılabilir.',
    ],
    [
      'Ortak fon ve bağışlar',
      'Ortak fona giren USDT ödünç vermek için kalır. Katkı çekilebilir bir ürün değildir. Bağış isteğe bağlıdır, proje cüzdanına gider ve fona girmez. Google Play içi satın alma yoktur: değer kamuya açık ağda hareket eder.',
    ],
    [
      'Riskler ve yaşadığınız ülkenin hukuku',
      'USDT ve ağ ücretleri değer değiştirebilir. Ağ transferleri geri alınamaz. Kurtarma cümlesini kaybederseniz o hesap açılmaz. Yüksek düzeyde fon olmayabilir. Quatrivium Finance uygulamayı sunar; protokol ağda çalışır. Kredi, davetler ve Rezerv yaşadığınız yerde düzenlenebilir. Uygulamayı yalnızca izinli olduğunuz yerde kullanmaktan siz sorumlusunuz. Bu metinler bilgidir; lisans, hukuki tavsiye veya her ülkede yetki vaadi değildir.',
    ],
    [
      'Hizmetin sınırları',
      'Rehberden veya tehditle tahsilat yapmayız. Gecikme, güncel olana dek ağ itibarını etkiler. Ağ kuralları veya hukuk gerektirirse protokolü duraklatabilir veya talebi reddedebiliriz. Destek: soporte@quatriviumcredit.app',
    ]
  ),
  vi: sections(
    [
      'Dữ liệu trên thiết bị này và trên mạng công khai',
      'Cụm 24 từ là chìa khóa tài khoản. Ở lại điện thoại này và bản sao của bạn; không ghi trên mạng. PIN, vân tay và mật khẩu chỉ mở điện thoại này. Địa chỉ ví, tín dụng, uy tín, lời mời và khóa Dự trữ được ghi trên mạng công khai và ai đọc mạng đó đều thấy. Ảnh hồ sơ và ảnh giấy tờ cục bộ có thể ở lại thiết bị; ảnh giấy tờ không gửi vào hồ sơ của chúng tôi. Email và điện thoại phục vụ tài khoản và thông báo.',
    ],
    [
      'Quyền và bên thứ ba',
      'Ứng dụng có thể xin máy ảnh (giấy tờ hoặc hồ sơ), thông báo (cảnh báo thanh toán và tài khoản) và sinh trắc học (để mở điện thoại này). Thông báo có thể gửi qua nhà cung cấp chuyên biệt chỉ theo chỉ dẫn của chúng tôi. Nếu liên kết ví ngoài, chính sách của dịch vụ đó và lớp kết nối cũng áp dụng. Chúng tôi không bán dữ liệu, không đọc danh bạ để đòi nợ và không dùng vị trí để duyệt tín dụng.',
    ],
    [
      'Lưu trữ, trẻ em và quyền của bạn',
      'Dữ liệu ngoài mạng (email, điện thoại, nhật ký thông báo) chỉ giữ khi tài khoản cần. Bạn có thể yêu cầu dừng thông báo và xóa bản sao ngoài mạng. Nội dung trên mạng công khai không xóa được. Dịch vụ chỉ dành cho người từ 18 tuổi. Chúng tôi không cố ý phục vụ trẻ em. Quyền riêng tư: privacidad@quatriviumcredit.app',
    ],
    [
      'Thay đổi chính sách này',
      'Nếu chính sách thay đổi trọng yếu, ứng dụng sẽ yêu cầu bạn đọc và chấp nhận bản mới trước khi tiếp tục. Ngày của bản hiện hành hiện khi chấp nhận. Bản ngày 3 tháng 10 năm 2026.',
    ],
    [
      'Dự trữ',
      'Dự trữ cho phép khóa USDT 30 ngày. Số khóa trả về tài khoản khi hết kỳ. Nếu quỹ riêng có nguồn, có thể cộng lợi suất ước tính tối đa 12%/năm cho những ngày đó. Lợi suất đó không bảo đảm và có thể bằng không. Dự trữ không phải tiền gửi ngân hàng, không phải kỳ hạn cố định và không phải sản phẩm đầu tư. Khóa từ cấp 10 và, ở tài khoản thật, sau cùng bước danh tính như tín dụng.',
    ],
    [
      'Quỹ chung và quyên góp',
      'USDT vào quỹ chung ở lại để cho vay. Góp không phải sản phẩm rút. Quyên góp tự nguyện, vào ví dự án, không vào quỹ. Không mua trong Google Play: giá trị chuyển trên mạng công khai.',
    ],
    [
      'Rủi ro và luật nơi bạn sống',
      'USDT và phí mạng có thể đổi giá trị. Chuyển trên mạng không hoàn. Mất cụm khôi phục thì không mở lại tài khoản đó. Cấp cao có thể không có quỹ. Quatrivium Finance cung cấp ứng dụng; giao thức chạy trên mạng. Tín dụng, giới thiệu và Dự trữ có thể bị điều tiết nơi bạn sống. Bạn chịu trách nhiệm chỉ dùng ứng dụng nơi được phép. Các văn bản này là thông tin, không phải giấy phép, tư vấn pháp lý hay lời hứa dịch vụ được cấp phép ở mọi quốc gia.',
    ],
    [
      'Giới hạn dịch vụ',
      'Chúng tôi không đòi qua danh bạ hay đe dọa. Trễ hạn ảnh hưởng uy tín trên mạng đến khi hoàn tất. Chúng tôi có thể tạm dừng giao thức hoặc từ chối yêu cầu nếu quy tắc mạng hoặc luật đòi hỏi. Hỗ trợ: soporte@quatriviumcredit.app',
    ]
  ),
  it: sections(
    [
      'Dati su questo dispositivo e sulla rete pubblica',
      'La frase di 24 parole è la chiave del conto. Resta su questo telefono e nel respaldo che fa; non si scrive in rete. PIN, impronta e password sbloccano solo questo telefono. Indirizzi, credito, reputazione, inviti e blocchi di Riserva restano su una rete pubblica e può vederli chi la consulta. La foto del profilo e la foto locale del documento possono restare sul dispositivo; quella del documento non va nei nostri fascicoli. Posta e telefono servono il conto e gli avvisi.',
    ],
    [
      'Permessi e terzi',
      'L’applicazione può chiedere fotocamera (documento o profilo), notifiche (avvisi di pagamento e di conto) e biometria (per sbloccare questo telefono). Gli avvisi possono uscire da fornitori specializzati che agiscono solo su nostre istruzioni. Se collega un portafoglio esterno, valgono anche le politiche di quel servizio e del relativo strato di connessione. Non vendiamo i suoi dati, non leggiamo la rubrica per riscuotere e non usiamo la posizione per approvare un credito.',
    ],
    [
      'Conservazione, minori e i suoi diritti',
      'I dati fuori rete (posta, telefono, registro avvisi) si conservano solo finché il conto ne ha bisogno. Può chiedere di interrompere gli avvisi e di cancellare le copie fuori rete. Quanto è scritto sulla rete pubblica non si cancella. Il servizio è solo per chi ha 18 anni o più. Non serviamo consapevolmente i minori. Privacy: privacidad@quatriviumcredit.app',
    ],
    [
      'Modifiche di questa informativa',
      'Se questa informativa cambia in modo rilevante, l’applicazione le chiederà di leggere e accettare la nuova versione prima di continuare. La data della versione vigente compare all’accettazione. Versione del 3 ottobre 2026.',
    ],
    [
      'Riserva',
      'Riserva consente di bloccare USDT per 30 giorni. L’importo bloccato torna sul conto al termine del periodo. Se un fondo separato ha risorse, può aggiungersi un rendimento stimato fino al 12% annuo per quei giorni. Quel rendimento non è garantito e può essere zero. Riserva non è un deposito bancario, non è un vincolo a termine e non è un prodotto di investimento. Il blocco è disponibile dal livello 10 e, nel Conto reale, dopo gli stessi passi di identità del credito.',
    ],
    [
      'Fondo comune e donazioni',
      'Gli USDT che entrano nel fondo comune restano destinati a prestare. Un versamento non è un prodotto di prelievo. Donare è volontario, va al portafoglio del progetto e non entra nel fondo. Non ci sono acquisti su Google Play: il valore si muove sulla rete pubblica.',
    ],
    [
      'Rischi e la legge del suo Paese',
      'USDT e le commissioni di rete possono cambiare valore. I trasferimenti in rete non si annullano. Se perde la frase di ripristino, quel conto non si riapre. Un livello alto può restare senza fondi. Quatrivium Finance offre l’applicazione; il protocollo gira sulla rete. Il credito, gli inviti e Riserva possono essere regolati dove vive. È responsabile di usare l’applicazione solo dove le è consentito. Questi testi informano; non sono una licenza, non sono consulenza legale e non promettono l’autorizzazione in tutti i Paesi.',
    ],
    [
      'Limiti del servizio',
      'Non riscuotiamo tramite i contatti né con minacce. Il ritardo influisce sulla reputazione in rete fino al saldo. Possiamo sospendere il protocollo o rifiutare una richiesta se le regole della rete o la legge lo impongono. Assistenza: soporte@quatriviumcredit.app',
    ]
  ),
};

export function legalExtrasFor(lang: Lang): ExtraDoc {
  return docs[lang] || docs.en;
}
