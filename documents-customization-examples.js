// ============================================================================
// ПРИМЕРЫ КАСТОМИЗАЦИИ ДОКУМЕНТОВ
// ============================================================================

/**
 * Пример 1: Добавить логотип компании в документ
 * 
 * Замените функцию generateTransferAct на:
 */

/*
async function generateTransferAct(rental) {
    const doc = new jspdf.jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    let yPosition = 15;
    const lineHeight = 7;
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    
    // Добавить логотип в верхний левый угол
    try {
        const logoUrl = 'https://via.placeholder.com/100x50?text=LOGO';
        doc.addImage(logoUrl, 'JPEG', margin, yPosition - 10, 40, 20);
    } catch (e) {
        console.log('Логотип не загружен');
    }
    
    // Информация о компании в верхний правый угол
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text('ООО "Наша Компания"', pageWidth - margin - 40, yPosition, { align: 'right' });
    doc.text('ИНН: 7707083893', pageWidth - margin - 40, yPosition + lineHeight, { align: 'right' });
    doc.text('ОГРН: 1077746000094', pageWidth - margin - 40, yPosition + lineHeight * 2, { align: 'right' });
    
    yPosition += 25;
    
    // Продолжление оригинального кода...
}
*/

/**
 * Пример 2: Изменить стиль и цвета документа
 * 
 * Добавьте эту функцию для использования в начале каждой функции генерации
 */
function applyCompanyBranding(doc) {
    // Цветная полоса сверху (фирменный цвет)
    doc.setFillColor(31, 78, 121); // Темно-синий цвет
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 15, 'F');
    
    // Текст компании в цветной полосе
    doc.setTextColor(255, 255, 255); // Белый текст
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('ООО "НАША КОМПАНИЯ"', doc.internal.pageSize.getWidth() / 2, 8, { align: 'center' });
    
    // Вернуть обычный цвет текста
    doc.setTextColor(0, 0, 0);
}

/**
 * Пример 3: Добавить таблицу с более подробной информацией
 */
function addDetailedInventoryTable(doc, rental, yPosition) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const tableWidth = pageWidth - (margin * 2);
    const colWidths = [60, 30, 30, 40];
    
    // Заголовки таблицы
    doc.setFillColor(200, 220, 255);
    doc.rect(margin, yPosition, colWidths[0], 8, 'F');
    doc.rect(margin + colWidths[0], yPosition, colWidths[1], 8, 'F');
    doc.rect(margin + colWidths[0] + colWidths[1], yPosition, colWidths[2], 8, 'F');
    doc.rect(margin + colWidths[0] + colWidths[1] + colWidths[2], yPosition, colWidths[3], 8, 'F');
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Предмет', margin + 2, yPosition + 5);
    doc.text('Кол-во', margin + colWidths[0] + 2, yPosition + 5);
    doc.text('Цена', margin + colWidths[0] + colWidths[1] + 2, yPosition + 5);
    doc.text('Сумма', margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, yPosition + 5);
    
    // Строка с данными
    yPosition += 10;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(rental.itemName, margin + 2, yPosition);
    doc.text(String(rental.quantity), margin + colWidths[0] + 2, yPosition);
    doc.text('___________', margin + colWidths[0] + colWidths[1] + 2, yPosition);
    doc.text('___________', margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, yPosition);
    
    // Граница таблицы
    doc.setDrawColor(0);
    doc.rect(margin, yPosition - 8, tableWidth, 18);
    
    return yPosition + 15;
}

/**
 * Пример 4: Добавить многострочный текст (условия использования)
 */
function addTermsOfUse(doc, yPosition) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    
    const terms = [
        '1. Арендатор обязуется использовать предмет аренды по назначению.',
        '2. Сохранение в надлежащем состоянии - обязанность арендатора.',
        '3. Запрещается передавать предмет третьим лицам без согласия.',
        '4. В случае повреждения - арендатор несет ответственность.',
        '5. Возврат должен быть осуществлен не позднее указанной даты.'
    ];
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    
    let currentY = yPosition;
    terms.forEach(term => {
        const splitText = doc.splitTextToSize(term, contentWidth);
        splitText.forEach(line => {
            doc.text(line, margin, currentY);
            currentY += 4;
        });
        currentY += 2;
    });
    
    doc.setTextColor(0, 0, 0);
    return currentY;
}

/**
 * Пример 5: Добавить штрих-код или QR-код (требует доп. библиотеки)
 * 
 * Сначала установите: npm install jsbarcode qrcode
 */

/*
function addQRCode(doc, rentalId, yPosition) {
    const canvas = document.createElement('canvas');
    QRCode.toCanvas(canvas, rentalId, { width: 100 }, (err) => {
        if (!err) {
            const imgData = canvas.toDataURL('image/png');
            doc.addImage(imgData, 'PNG', 170, yPosition, 30, 30);
        }
    });
}
*/

/**
 * Пример 6: Использовать более красивые шрифты
 */
function applyCustomFonts(doc) {
    doc.setFont('Times');  // Изменить на Times вместо стандартного
    // Можно также добавить кастомные шрифты если нужно
}

/**
 * Пример 7: Полная кастомизированная функция актa
 */
async function generateTransferActCustomized(rental) {
    const doc = new jspdf.jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    let yPosition = 15;
    const lineHeight = 7;
    const margin = 15;
    
    // 1. Применить брендинг компании
    applyCompanyBranding(doc);
    yPosition = 25;
    
    // 2. Основной заголовок с кастомным стилем
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(31, 78, 121); // Фирменный цвет
    doc.text('АКТ ПЕРЕДАЧИ ИНВЕНТАРЯ', pageWidth / 2, yPosition, { align: 'center' });
    doc.setTextColor(0, 0, 0); // Вернуть черный цвет
    
    yPosition += lineHeight * 2;
    
    // 3. Номер и дата с стилем
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const documentNumber = `АКТ-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Стилизованное поле с информацией
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPosition - 3, pageWidth - (margin * 2), 10, 'F');
    doc.text(`Номер: ${documentNumber}  |  Дата: ${new Date().toLocaleDateString('ru-RU')}`, margin + 2, yPosition + 2);
    
    yPosition += 15;
    
    // 4. Использовать таблицу вместо списков
    yPosition = addDetailedInventoryTable(doc, rental, yPosition);
    
    // 5. Добавить условия использования
    yPosition = addTermsOfUse(doc, yPosition);
    
    yPosition += 10;
    
    // 6. Подписи с более красивым форматированием
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Подписи и печати сторон:', margin, yPosition);
    yPosition += lineHeight * 3;
    
    // Две колоны подписей
    const colX1 = margin;
    const colX2 = pageWidth / 2;
    
    doc.setFont(undefined, 'normal');
    doc.text('От организации:', colX1, yPosition);
    doc.setFont(undefined, 'bold');
    doc.text('От арендатора:', colX2, yPosition);
    
    yPosition += 15;
    
    doc.setFont(undefined, 'normal');
    doc.text('_______________________', colX1, yPosition);
    doc.text('_______________________', colX2, yPosition);
    yPosition += 3;
    doc.setFontSize(8);
    doc.text('(подпись)', colX1, yPosition);
    doc.text('(подпись)', colX2, yPosition);
    yPosition += 5;
    doc.text('(ФИО)', colX1, yPosition);
    doc.text('(ФИО)', colX2, yPosition);
    yPosition += 5;
    doc.text('(дата)', colX1, yPosition);
    doc.text('(дата)', colX2, yPosition);
    
    // Добавить нижний колонтитул
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(documentNumber, pageWidth / 2, pageHeight - 5, { align: 'center' });
    
    doc.save(`Акт передачи - ${documentNumber}.pdf`);
}

// ============================================================================
// КАК ИСПОЛЬЗОВАТЬ ПРИМЕРЫ
// ============================================================================

/*
1. Замене вызов generateTransferAct на generateTransferActCustomized
   в функции downloadSelectedDocuments():
   
   if (docTransfer) {
       await generateTransferActCustomized(currentRentalForDocuments);
       await new Promise(resolve => setTimeout(resolve, 500));
   }

2. Или скопируйте код из примеров прямо в существующие функции

3. Для добавления QR-кодов:
   - Установите библиотеку: npm install qrcode
   - Раскомментируйте пример сверху
   - Вызовите addQRCode() в нужном месте функции

4. Тестируйте изменения в браузере перед финальным развертыванием
*/
