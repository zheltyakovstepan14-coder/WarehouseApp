# Архитектура и потоки данных

## 1) Контекстная архитектура

```mermaid
flowchart LR
    user[User]
    browser[BrowserUI]
    frontend[IndexHtmlScriptCss]
    backend[ExpressApiServer]
    auth[AuthMiddlewareJWT]
    routes[DomainRoutes]
    db[(PostgreSQL)]

    user --> browser
    browser --> frontend
    frontend -->|HTTP JSON| backend
    backend --> auth
    auth --> routes
    routes --> db
```

## 2) Доменные сущности (ER-уровень)

```mermaid
flowchart TB
    users[users]
    clients[clients]
    employees[employees]
    inventory[inventory]
    rentals[rentals]
    rentalItems[rental_items]
    events[events]
    eventItems[event_items]
    purchaseRequests[purchase_requests]
    purchaseRequestItems[purchase_request_items]
    docs[issuance_transfer_acceptance_writeoff]

    clients --> rentals
    employees --> rentals
    employees --> events
    rentals --> rentalItems
    events --> eventItems
    inventory --> rentalItems
    inventory --> eventItems
    purchaseRequests --> purchaseRequestItems
    inventory --> purchaseRequestItems
    rentals --> docs
    events --> docs
    users --> purchaseRequests
```

## 3) Процесс от дефицита до закрытия документов

```mermaid
flowchart LR
    stockCheck[InventoryDeficitDetected]
    createDraft[CreateOrRefreshPurchaseDraft]
    approve[ApproveRequest]
    delivery[ApplyDelivery]
    issueDoc[IssueTransferDocuments]
    acceptance[AcceptanceOrReturn]
    writeoff[WriteoffIfNeeded]
    report[UpdateDashboardReports]

    stockCheck --> createDraft
    createDraft --> approve
    approve --> delivery
    delivery --> issueDoc
    issueDoc --> acceptance
    acceptance --> writeoff
    writeoff --> report
```

## 4) Технические примечания для защиты
- Backend: [d:\\ВКР\\WarehouseApp\\server.js](d:\\ВКР\\WarehouseApp\\server.js)
- Ключевые маршруты:
  - [d:\\ВКР\\WarehouseApp\\routes\\inventory.js](d:\\ВКР\\WarehouseApp\\routes\\inventory.js)
  - [d:\\ВКР\\WarehouseApp\\routes\\rentals.js](d:\\ВКР\\WarehouseApp\\routes\\rentals.js)
  - [d:\\ВКР\\WarehouseApp\\routes\\events.js](d:\\ВКР\\WarehouseApp\\routes\\events.js)
  - [d:\\ВКР\\WarehouseApp\\routes\\documents.js](d:\\ВКР\\WarehouseApp\\routes\\documents.js)
- Frontend core:
  - [d:\\ВКР\\WarehouseApp\\index.html](d:\\ВКР\\WarehouseApp\\index.html)
  - [d:\\ВКР\\WarehouseApp\\script.js](d:\\ВКР\\WarehouseApp\\script.js)
  - [d:\\ВКР\\WarehouseApp\\warehouse-advanced.js](d:\\ВКР\\WarehouseApp\\warehouse-advanced.js)
