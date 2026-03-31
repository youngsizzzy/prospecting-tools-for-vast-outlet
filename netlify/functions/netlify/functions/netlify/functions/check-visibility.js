exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { url } = JSON.parse(event.body || '{}');
  if (!url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
  }

  try {
    // Fetch the actual page HTML
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VastOutletBot/1.0)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    const html = await res.text();
    const finalUrl = res.url;
    const lower = html.toLowerCase();

    // --- 1. HTTPS ---
    const hasHttps = finalUrl.startsWith('https');

    // --- 2. Local Business Schema (JSON-LD) ---
    const hasSchema =
      lower.includes('"localBusiness"') ||
      lower.includes('"plumber"') ||
      lower.includes('"electrician"') ||
      lower.includes('"hvac"') ||
      lower.includes('"roofer"') ||
      lower.includes('"contractor"') ||
      lower.includes('"dentist"') ||
      lower.includes('"lawyer"') ||
      lower.includes('"realestate"') ||
      (lower.includes('application/ld+json') &&
        (lower.includes('"@type"') || lower.includes('@type')));

    // --- 3. NAP Consistency (Name, Address, Phone) ---
    const hasPhone =
      /(\+1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/.test(html);
    const hasAddress =
      lower.includes(' st,') ||
      lower.includes(' ave,') ||
      lower.includes(' blvd') ||
      lower.includes(' road') ||
      lower.includes(' drive') ||
      lower.includes(' lane') ||
      lower.includes(' street') ||
      lower.includes(' suite ') ||
      /\d{5}(-\d{4})?/.test(html); // ZIP code
    const hasNAP = hasPhone && hasAddress;

    // --- 4. FAQ / Q&A Content ---
    const hasFAQ =
      lower.includes('faq') ||
      lower.includes('frequently asked') ||
      lower.includes('question') ||
      lower.includes('itemtype="https://schema.org/faqpage"') ||
      lower.includes('"faqpage"');

    // --- 5. Descriptive Title with Location ---
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = titleMatch ? titleMatch[1].toLowerCase() : '';
    const hasGoodTitle =
      titleText.length > 20 &&
      (titleText.includes(' in ') ||
        titleText.includes(' near ') ||
        /[a-z]{3,},?\s+[a-z]{2}/.test(titleText) || // City, ST
        titleText.split(' ').length >= 5);

    // --- 6. Meta Description with Keywords ---
    const metaMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
    );
    const metaDesc = metaMatch ? metaMatch[1] : '';
    const hasMetaDesc = metaDesc.length > 50;

    // --- 7. Clear H1 with Primary Service ---
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1Text = h1Match
      ? h1Match[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
      : '';
    const hasH1 = h1Text.length > 5;

    // --- 8. Mobile Friendly & Fast (from PageSpeed) ---
    // This is passed in from the frontend — default true if not provided
    const { mobileScore } = JSON.parse(event.body || '{}');
    const hasMobile = mobileScore != null ? mobileScore >= 60 : true;

    // --- 9. Review Schema / Aggregate Rating ---
    const hasReviewSchema =
      lower.includes('"aggregaterating"') ||
      lower.includes('aggregateRating') ||
      lower.includes('"ratingvalue"') ||
      lower.includes('ratingValue') ||
      lower.includes('itemtype="https://schema.org/review"');

    // --- 10. Substantive Content (300+ words) ---
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const wordCount = textContent.split(' ').filter(w => w.length > 2).length;
    const hasContent = wordCount >= 300;

    const results = {
      https:   { pass: hasHttps,        detail: hasHttps ? 'Site uses HTTPS' : 'Site is HTTP only — insecure' },
      schema:  { pass: hasSchema,        detail: hasSchema ? 'JSON-LD schema detected' : 'No LocalBusiness schema found' },
      nap:     { pass: hasNAP,           detail: hasNAP ? 'Phone and address found on page' : `Missing: ${!hasPhone ? 'phone ' : ''}${!hasAddress ? 'address' : ''}` },
      faq:     { pass: hasFAQ,           detail: hasFAQ ? 'FAQ content detected' : 'No FAQ section found' },
      title:   { pass: hasGoodTitle,     detail: hasGoodTitle ? `Title: "${titleMatch?.[1]?.slice(0,60)}"` : `Weak title: "${titleMatch?.[1]?.slice(0,60) || 'none'}"` },
      meta:    { pass: hasMetaDesc,      detail: hasMetaDesc ? `Meta desc: "${metaDesc.slice(0,60)}..."` : 'No meta description found' },
      h1:      { pass: hasH1,            detail: hasH1 ? `H1: "${h1Text.slice(0,60)}"` : 'No H1 heading found' },
      mobile:  { pass: hasMobile,        detail: hasMobile ? `Mobile score: ${mobileScore ?? 'N/A'}/100` : `Poor mobile score: ${mobileScore}/100` },
      reviews: { pass: hasReviewSchema,  detail: hasReviewSchema ? 'Review/rating schema detected' : 'No aggregate rating schema' },
      content: { pass: hasContent,       detail: hasContent ? `~${wordCount} words detected` : `Only ~${wordCount} words — too thin` },
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, results, wordCount, titleText, metaDesc, h1Text }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, error: err.message, results: null }),
    };
  }
};
