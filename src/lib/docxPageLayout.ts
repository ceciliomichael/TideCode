interface PageChildDescriptor {
  articleIndex: number
  node: Node
}

function isArticleElement(element: Element) {
  return element.tagName.toLowerCase() === 'article'
}

function getPageHeight(page: HTMLElement) {
  const computedStyle = window.getComputedStyle(page)
  const minimumPageHeight = Number.parseFloat(computedStyle.minHeight)
  if (Number.isFinite(minimumPageHeight) && minimumPageHeight > 0) {
    return minimumPageHeight
  }

  const explicitPageHeight = Number.parseFloat(computedStyle.height)
  return Number.isFinite(explicitPageHeight) && explicitPageHeight > 0 ? explicitPageHeight : page.clientHeight
}

function lockPageHeight(page: HTMLElement) {
  const pageHeight = getPageHeight(page)
  if (pageHeight > 0) {
    page.style.height = `${pageHeight}px`
  }
}

function isPageOverflowing(page: HTMLElement) {
  const pageHeight = getPageHeight(page)
  if (pageHeight <= 0) {
    return false
  }

  const pageTop = page.getBoundingClientRect().top
  const articleBottom = Math.max(
    0,
    ...Array.from(page.children)
      .filter(isArticleElement)
      .map((article) => article.getBoundingClientRect().bottom - pageTop),
  )
  return page.scrollHeight > pageHeight + 1 || articleBottom > pageHeight + 1
}

function createEmptyPage(pageTemplate: HTMLElement, originalArticles: readonly HTMLElement[]) {
  const page = pageTemplate.cloneNode(false) as HTMLElement
  lockPageHeight(page)
  const articleNodes: HTMLElement[] = []

  Array.from(pageTemplate.children).forEach((child) => {
    if (isArticleElement(child)) {
      const article = child.cloneNode(false) as HTMLElement
      articleNodes.push(article)
      page.appendChild(article)
      return
    }

    page.appendChild(child.cloneNode(true))
  })

  while (articleNodes.length < originalArticles.length) {
    const article = originalArticles[articleNodes.length].cloneNode(false) as HTMLElement
    articleNodes.push(article)
    page.appendChild(article)
  }

  return { articleNodes, page }
}

function collectPageChildren(page: HTMLElement) {
  const articleChildren: PageChildDescriptor[] = []
  let articleIndex = 0

  Array.from(page.children).forEach((child) => {
    if (!isArticleElement(child)) {
      return
    }

    Array.from(child.childNodes).forEach((node) => {
      articleChildren.push({ articleIndex, node: node.cloneNode(true) })
    })
    articleIndex += 1
  })

  return articleChildren
}

function normalizeDocxPageStack(wrapper: HTMLElement) {
  wrapper.style.alignItems = 'center'
  wrapper.style.background = 'transparent'
  wrapper.style.display = 'flex'
  wrapper.style.flexDirection = 'column'
  wrapper.style.gap = '16px'
  wrapper.style.margin = '0'
  wrapper.style.padding = '0'
  wrapper.style.width = 'max-content'
  Array.from(wrapper.children).forEach((child) => {
    if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'section') {
      child.style.marginBottom = '0'
    }
  })
}

function paginatePage(wrapper: HTMLElement, originalPage: HTMLElement) {
  const pageTemplate = originalPage.cloneNode(true) as HTMLElement
  const originalArticles = Array.from(pageTemplate.children).filter(isArticleElement) as HTMLElement[]
  const pageChildren = collectPageChildren(pageTemplate)
  if (originalArticles.length === 0 || pageChildren.length === 0 || !isPageOverflowing(originalPage)) {
    return 1
  }

  lockPageHeight(originalPage)
  const originalPageIndex = Array.from(wrapper.children).indexOf(originalPage)
  let currentPage = originalPage
  const firstPageData = createEmptyPage(pageTemplate, originalArticles)
  currentPage.replaceChildren(...Array.from(firstPageData.page.childNodes))
  let currentPageArticles = firstPageData.articleNodes
  let currentPageItemCount = 0
  let pageCount = 1

  for (const pageChild of pageChildren) {
    const article = currentPageArticles[pageChild.articleIndex]
    if (!article) {
      continue
    }

    article.appendChild(pageChild.node)
    currentPageItemCount += 1
    if (currentPageItemCount <= 1 || !isPageOverflowing(currentPage)) {
      continue
    }

    article.removeChild(pageChild.node)
    currentPageItemCount -= 1
    const nextPageData = createEmptyPage(pageTemplate, originalArticles)
    const nextPage = nextPageData.page
    const nextArticle = nextPageData.articleNodes[pageChild.articleIndex]
    if (!nextArticle) {
      continue
    }

    nextArticle.appendChild(pageChild.node)
    currentPageItemCount = 1
    currentPageArticles = nextPageData.articleNodes
    wrapper.insertBefore(nextPage, wrapper.children[originalPageIndex + pageCount] ?? null)
    currentPage = nextPage
    pageCount += 1
  }

  return pageCount
}

export function paginateDocxPages(container: HTMLElement) {
  const wrapper = container.querySelector<HTMLElement>('.tidecode-docx-wrapper')
  if (!wrapper) {
    return 0
  }

  normalizeDocxPageStack(wrapper)
  const originalPages = Array.from(wrapper.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === 'section',
  )
  let pageCount = 0
  originalPages.forEach((page) => {
    pageCount += paginatePage(wrapper, page)
  })
  return pageCount
}
