// IceYoo Desaru — mobile ordering page recreation (full menu)
const { useState } = React;

// ── icons ─────────────────────────────────────────────────────
const IconBack = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M15 5L8 12l7 7" stroke="#111" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconGlobe = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="#111" strokeWidth="1.8"/>
    <path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18" stroke="#111" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);
const IconChev = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M6 9l6 6 6-6" stroke="#111" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconReceipt = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3 5 4.5V3z"
      stroke="#111" strokeWidth="1.6" strokeLinejoin="round" fill="none"/>
    <path d="M8 9h8M8 13h6" stroke="#111" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);
const IconDots = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="12" r="1.8" fill="#111"/>
    <circle cx="12" cy="12" r="1.8" fill="#111"/>
    <circle cx="19" cy="12" r="1.8" fill="#111"/>
  </svg>
);
const IconInfo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#111"/>
    <circle cx="12" cy="7.5" r="1.2" fill="#fff"/>
    <rect x="11" y="10" width="2" height="7" rx="1" fill="#fff"/>
  </svg>
);
const IconMemberPlus = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 28 24" fill="none">
    <circle cx="9" cy="7" r="3.2" stroke="#F08531" strokeWidth="1.7"/>
    <path d="M2.5 21c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" stroke="#F08531" strokeWidth="1.7" strokeLinecap="round"/>
    <circle cx="19" cy="9" r="2.6" stroke="#F08531" strokeWidth="1.7"/>
    <path d="M14.5 18c.6-2.4 2.6-4.2 4.5-4.2 1.8 0 3.6 1.5 4.4 3.6" stroke="#F08531" strokeWidth="1.7" strokeLinecap="round"/>
    <circle cx="23" cy="5" r="3.2" fill="#fff" stroke="#F08531" strokeWidth="1.7"/>
    <path d="M23 3.4v3.2M21.4 5h3.2" stroke="#F08531" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

// ── thumbnail primitives ─────────────────────────────────────
// YY yellow badge
const YYBadge = ({ cx = 50, cy = 46, r = 9 }) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill="#f7c948" stroke="#a87a14" strokeWidth="1.2"/>
    <text x={cx} y={cy + 3.2} textAnchor="middle" fontFamily="Arial Black, sans-serif"
      fontSize={r * 1} fill="#6a3f10" fontWeight="900">YY</text>
  </g>
);

// Iceyoo cup thumbnail — shaved-ice mound in a small cup with YY badge
const IceyooThumb = ({ mound = '#3a2418', bg = '#fbeed2', topping }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill={bg}/>
    {/* cup */}
    <path d="M22 58 L78 58 L72 92 L28 92 Z" fill="#fff3df" stroke="#e8d8b8" strokeWidth="1"/>
    {/* mound */}
    <path d="M22 58 C 26 38, 38 28, 50 28 C 62 28, 74 38, 78 58 Z" fill={mound}/>
    {topping}
    <YYBadge/>
  </svg>
);

const BingsuThumb = ({ mound = '#f5f5f5', drip }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdfaf3"/>
    {/* wood board */}
    <rect x="6" y="74" width="88" height="14" rx="3" fill="#caa170"/>
    <rect x="6" y="74" width="88" height="3" fill="#b48a5a"/>
    {/* bowl */}
    <ellipse cx="38" cy="74" rx="22" ry="7" fill="#efe6d8"/>
    <path d="M16 72 C 18 56, 30 44, 38 44 C 46 44, 58 56, 60 72 Z" fill="#fff"/>
    {/* mound */}
    <path d="M18 60 C 22 38, 32 28, 38 28 C 44 28, 54 38, 58 60 Z" fill={mound}/>
    {drip}
    {/* side cups */}
    <rect x="64" y="60" width="10" height="14" rx="1" fill="#fff" stroke="#e0d3bd" strokeWidth="0.8"/>
    <rect x="78" y="60" width="10" height="14" rx="1" fill="#fff" stroke="#e0d3bd" strokeWidth="0.8"/>
    <rect x="65" y="62" width="8" height="6" fill="#d4a574"/>
    <rect x="79" y="63" width="8" height="5" fill="#7a4a2b"/>
  </svg>
);

const ChickenWingThumb = ({ glaze = '#c13a1f' }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    <ellipse cx="50" cy="60" rx="38" ry="22" fill="#fff" stroke="#e8e0cf" strokeWidth="1"/>
    {/* lettuce */}
    <path d="M16 60 q 6 -6 14 -2 q 8 4 16 -2 q 8 -6 16 0 q 8 6 16 -2" fill="#a8d96a" opacity="0.7"/>
    {/* wings clusters */}
    {[[36,52],[50,50],[64,54],[42,62],[58,62],[50,66]].map(([x,y], i) => (
      <g key={i}>
        <ellipse cx={x} cy={y} rx="9" ry="7" fill={glaze}/>
        <ellipse cx={x-1} cy={y-1} rx="6" ry="3.5" fill="#e57a55" opacity="0.45"/>
      </g>
    ))}
  </svg>
);

const PopcornChickenThumb = ({ glaze = '#d97a25' }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    <ellipse cx="50" cy="64" rx="36" ry="18" fill="#fff" stroke="#e8e0cf" strokeWidth="1"/>
    {Array.from({length: 22}).map((_, i) => {
      const x = 22 + (i % 6) * 12 + (Math.floor(i/6)%2 ? 4 : 0);
      const y = 50 + Math.floor(i/6) * 7;
      return <circle key={i} cx={x} cy={y} r="5" fill={glaze} stroke="#a04a10" strokeWidth="0.6"/>;
    })}
  </svg>
);

const NoodleBoxThumb = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    {/* kraft box */}
    <path d="M14 50 L86 50 L82 88 L18 88 Z" fill="#caa46b" stroke="#a07d49" strokeWidth="1"/>
    <path d="M14 50 L86 50 L84 56 L16 56 Z" fill="#b48a5a"/>
    {/* noodles */}
    <path d="M22 56 q 8 -4 16 0 q 8 4 16 -2 q 8 -4 16 2 q 6 4 6 6" stroke="#ecc35c" strokeWidth="2" fill="none"/>
    <path d="M20 64 q 10 -4 18 2 q 10 6 18 -2 q 10 -6 18 2" stroke="#e0a838" strokeWidth="2" fill="none"/>
    {/* chicken bits */}
    <circle cx="38" cy="60" r="4" fill="#b94a1c"/>
    <circle cx="56" cy="58" r="4" fill="#b94a1c"/>
    <circle cx="68" cy="64" r="3.5" fill="#b94a1c"/>
    {/* greens */}
    <ellipse cx="30" cy="56" rx="3" ry="1.5" fill="#7fbf3f"/>
    <ellipse cx="64" cy="55" rx="3" ry="1.5" fill="#7fbf3f"/>
  </svg>
);

const WrapThumb = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    {/* two wraps */}
    {[[28,60,-10],[62,58,8]].map(([cx,cy,rot], i) => (
      <g key={i} transform={`rotate(${rot} ${cx} ${cy})`}>
        <rect x={cx-18} y={cy-22} width="36" height="44" rx="14" fill="#f0d9a8" stroke="#caa46b" strokeWidth="1"/>
        <rect x={cx-13} y={cy-16} width="26" height="10" fill="#86bf5a"/>
        <rect x={cx-13} y={cy-6} width="26" height="6" fill="#c14a2a"/>
      </g>
    ))}
  </svg>
);

const FriesThumb = ({ topping = 'cheese' }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    {/* black tray */}
    <path d="M10 56 Q 50 36, 90 56 Q 86 80, 50 84 Q 14 80, 10 56 Z" fill="#1a1a1a"/>
    {/* fries pile */}
    {Array.from({length: 14}).map((_, i) => {
      const x = 22 + i * 4 + (i % 2 ? 1 : 0);
      const y = 50 + (i % 3) * 2;
      return <rect key={i} x={x} y={y} width="3" height={18 + (i%3)*2} fill="#e8b04a" rx="1"/>;
    })}
    {/* topping */}
    {topping === 'cheese' && (
      <g>
        <path d="M20 56 q 10 6 20 -2 q 10 -6 20 4 q 10 8 20 -4" stroke="#fff8c0" strokeWidth="3" fill="none"/>
        <path d="M18 64 q 12 4 24 -2 q 12 -4 24 4 q 6 4 12 2" stroke="#fff8c0" strokeWidth="2.5" fill="none"/>
      </g>
    )}
    {topping === 'teriyaki' && (
      <g>
        <circle cx="38" cy="58" r="3.5" fill="#7a3a14"/>
        <circle cx="52" cy="56" r="3" fill="#7a3a14"/>
        <circle cx="64" cy="60" r="3.5" fill="#7a3a14"/>
        <path d="M22 64 q 14 -2 28 2 q 14 4 28 -2" stroke="#fff" strokeWidth="1.5" fill="none"/>
      </g>
    )}
    {topping === 'wedge' && (
      <g>
        {[30,40,50,60,70].map((x, i) => (
          <path key={i} d={`M${x} 52 L${x+8} 52 L${x+6} 72 L${x+2} 72 Z`} fill="#d99a3a" stroke="#8a5a14" strokeWidth="0.8"/>
        ))}
        <path d="M28 60 q 16 -2 32 4 q 8 2 16 0" stroke="#fff" strokeWidth="2" fill="none"/>
      </g>
    )}
  </svg>
);

const NuggetsThumb = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    {/* paper-lined cup */}
    <path d="M22 48 L78 48 L74 90 L26 90 Z" fill="#dec48a" stroke="#a98a4a" strokeWidth="1"/>
    <path d="M26 48 L74 48 L72 56 L28 56 Z" fill="#fff"/>
    {/* nuggets */}
    {[[36,38],[50,32],[62,40],[44,28],[58,28]].map(([x,y], i) => (
      <ellipse key={i} cx={x} cy={y} rx="8" ry="6" fill="#e8a248" stroke="#a05e10" strokeWidth="0.8"/>
    ))}
  </svg>
);

const WaffleThumb = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    {/* plate */}
    <ellipse cx="50" cy="70" rx="40" ry="10" fill="#caa46b"/>
    {/* waffle */}
    <rect x="20" y="48" width="42" height="28" rx="4" fill="#e0a85a" stroke="#a87018" strokeWidth="1"/>
    {[0,1,2,3].map(c => [0,1,2].map(r => (
      <rect key={`${c}-${r}`} x={24 + c*10} y={52 + r*8} width="6" height="4" fill="#a87018" opacity="0.5"/>
    )))}
    {/* ice cream scoops */}
    <circle cx="64" cy="46" r="9" fill="#fff" stroke="#e0d3bd" strokeWidth="0.8"/>
    <circle cx="76" cy="52" r="7" fill="#fff" stroke="#e0d3bd" strokeWidth="0.8"/>
    <YYBadge cx="42" cy="58" r="6"/>
  </svg>
);

// Woori tall blended cup — translucent dome lid, body color varies, 우리 wordmark
const WooriThumb = ({ body = '#f7c948' }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdfaf3"/>
    {/* shadow */}
    <ellipse cx="50" cy="92" rx="22" ry="3" fill="#000" opacity="0.08"/>
    {/* cup body — tapered tumbler */}
    <path d="M30 30 L70 30 L66 88 L34 88 Z" fill={body} stroke="rgba(0,0,0,0.06)" strokeWidth="0.6"/>
    {/* dome lid */}
    <path d="M28 30 Q 50 6, 72 30 L70 32 L30 32 Z" fill={body} opacity="0.85"/>
    <path d="M28 30 Q 50 10, 72 30" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1"/>
    {/* mound visible behind dome */}
    <path d="M30 30 Q 50 12, 70 30 Z" fill={body}/>
    {/* highlight */}
    <path d="M36 36 L40 80" stroke="rgba(255,255,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
    {/* 우리 wordmark */}
    <text x="50" y="62" textAnchor="middle" fontFamily="'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif"
      fontSize="11" fontWeight="700" fill="rgba(255,255,255,0.9)">우리</text>
  </svg>
);

const BowlThumb = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <rect width="100" height="100" fill="#fdf9f0"/>
    {/* lettuce */}
    <path d="M14 56 q 8 -10 18 -4 q 8 4 16 -4 q 8 -8 18 -2 q 10 6 18 -2 q 4 4 4 12 v 28 H 14 Z" fill="#7fbf3f"/>
    {/* bowl */}
    <ellipse cx="50" cy="60" rx="28" ry="18" fill="#fff" stroke="#caa46b" strokeWidth="1"/>
    <ellipse cx="50" cy="58" rx="24" ry="10" fill="#caa46b" opacity="0.3"/>
    <circle cx="44" cy="56" r="3" fill="#b94a1c"/>
    <circle cx="54" cy="58" r="2.5" fill="#e8a248"/>
    <circle cx="48" cy="62" r="2" fill="#7a3a14"/>
    <circle cx="58" cy="54" r="1.8" fill="#fff" stroke="#caa46b" strokeWidth="0.6"/>
  </svg>
);

// 1+1 promo
const PromoBanner = () => (
  <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
    <defs>
      <pattern id="checker" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" fill="#f5c93a"/>
        <rect width="7" height="7" fill="#e9b520"/>
        <rect x="7" y="7" width="7" height="7" fill="#e9b520"/>
      </pattern>
    </defs>
    <rect width="100" height="100" fill="url(#checker)"/>
    <g fontFamily="Impact, 'Arial Black', sans-serif" fontWeight="900" fill="#7a4a06">
      <text x="10" y="46" fontSize="44" letterSpacing="-2">1+1</text>
    </g>
    <g transform="translate(8 56)">
      <rect x="0" y="0" width="62" height="22" rx="3" fill="#7a4a06"/>
      <text x="6" y="16" fontFamily="Impact, 'Arial Black', sans-serif" fontSize="16" fill="#f5c93a" fontWeight="900">RM18.9</text>
    </g>
  </svg>
);

// ── chrome ────────────────────────────────────────────────────
function HeroTopBar() {
  return (
    <div style={{
      position: 'absolute', top: 56, left: 0, right: 0,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0 14px', zIndex: 5,
    }}>
      <button style={{
        width: 38, height: 38, borderRadius: '50%', background: '#fff',
        border: 'none', boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        <IconBack />
      </button>
      <button style={{
        height: 34, padding: '0 12px', borderRadius: 999, background: '#fff',
        border: 'none', boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        fontSize: 14, fontWeight: 500, color: '#111',
      }}>
        <IconGlobe />
        <span>English</span>
        <IconChev />
      </button>
    </div>
  );
}

function FloatingActions() {
  return (
    <div style={{
      position: 'absolute', bottom: 14, right: 14, display: 'flex', gap: 8, zIndex: 5,
    }}>
      <button style={{
        height: 38, padding: '0 14px', borderRadius: 999, background: '#fff',
        border: 'none', boxShadow: '0 3px 10px rgba(0,0,0,0.10)',
        display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
        fontSize: 14, fontWeight: 600, color: '#111',
      }}>
        <IconReceipt />
        <span>Order History</span>
      </button>
      <button style={{
        width: 38, height: 38, borderRadius: '50%', background: '#fff',
        border: 'none', boxShadow: '0 3px 10px rgba(0,0,0,0.10)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        <IconDots />
      </button>
    </div>
  );
}

function RestaurantHeader({ onChatClick }) {
  return (
    <div style={{ background: '#fff', padding: '20px 18px 18px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', color: '#111' }}>IceYoo Desaru</h1>
          <div style={{ marginTop: 10, fontSize: 14, fontWeight: 500 }}>
            <span style={{ color: '#19a34a' }}>Open until </span>
            <span style={{ color: '#111' }}>10:00 PM (Sat)</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          {/* chat bubble — sits to the LEFT of the photo placeholder per design */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            transform: 'translateX(-40%)',
          }}>
            <window.ChatIconButton onClick={onChatClick} size={60} />
            <span style={{ fontSize: 11, fontWeight: 800, color: '#111', letterSpacing: 0.2 }}>AI Assistant</span>
          </div>
          <div style={{
            width: 56, height: 56, border: '1px solid #d6d6d6', borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="#bdbdbd" strokeWidth="1.5"/>
              <path d="M3 17l5-5 4 4 3-3 6 6" stroke="#bdbdbd" strokeWidth="1.5" fill="none"/>
              <circle cx="9" cy="9" r="1.6" fill="#bdbdbd"/>
            </svg>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 16, background: '#fdece0', borderRadius: 10,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
      }}>
        <IconMemberPlus />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Join Member</span>
      </div>
    </div>
  );
}

// ── menu data ─────────────────────────────────────────────────
const yyTopping = {
  oreo: <g>
    <circle cx="38" cy="42" r="3" fill="#1a0f0a"/>
    <circle cx="55" cy="36" r="2.5" fill="#1a0f0a"/>
    <circle cx="63" cy="46" r="2.8" fill="#1a0f0a"/>
    <circle cx="44" cy="50" r="2" fill="#1a0f0a"/>
  </g>,
  milo: <path d="M28 56 q5 -10 10 -2 q5 8 10 -3 q5 -10 10 0 q5 10 10 -2 q3 -5 6 6 v8 H22 Z" fill="#5a2e10" opacity="0.7"/>,
  straw: <g><circle cx="38" cy="44" r="3" fill="#c8344a"/><circle cx="58" cy="40" r="2.5" fill="#c8344a"/></g>,
};

const sections = [
  {
    title: 'YOOYOO SAVER',
    items: [
      { name: '(Any 2) YooYoo Saver', thumb: <PromoBanner/>, noImg: true },
      { name: 'YS01. Oreo Iceyoo (SE)',          kw: 'oreo shaved ice', thumb: <IceyooThumb mound="#3a2418" bg="#f1e6d2" topping={yyTopping.oreo}/> },
      { name: 'YS02. Milo Lava Iceyoo (SE)',     kw: 'milo dessert', thumb: <IceyooThumb mound="#fbe6c2" bg="#fbeed2" topping={yyTopping.milo}/> },
      { name: 'YS03. Coconut Iceyoo (SE)',       kw: 'coconut shaved ice', thumb: <IceyooThumb mound="#ffffff" bg="#eef6f8"/> },
      { name: 'YS04. Mango Iceyoo (SE)',         kw: 'mango shaved ice', thumb: <IceyooThumb mound="#f7d34a" bg="#fff3c4"/> },
      { name: 'YS05. Watermelon Iceyoo (SE)',    kw: 'watermelon shaved ice', thumb: <IceyooThumb mound="#ffb3b8" bg="#fde6e0" topping={yyTopping.straw}/> },
      { name: 'YS06. Thai Tea Iceyoo (SE)',      kw: 'thai tea dessert', thumb: <IceyooThumb mound="#e0a86a" bg="#fbeed2" topping={yyTopping.milo}/> },
      { name: 'YS07. Milo Dinosaur Iceyoo (SE)', kw: 'chocolate dessert', thumb: <IceyooThumb mound="#7a4a14" bg="#f5e3c0" topping={yyTopping.milo}/> },
      { name: 'YS08. Popcorn Chicken Noodle (S)', kw: 'korean noodles', thumb: <NoodleBoxThumb/> },
      { name: 'YS09. Korean Chicken Wrap...',     kw: 'chicken wrap', thumb: <WrapThumb/> },
      { name: 'YS10. Teriyaki Fries (M)..',       kw: 'loaded fries', thumb: <FriesThumb topping="teriyaki"/> },
      { name: 'YS11. Cheezy Wedges (M)',          kw: 'potato wedges', thumb: <FriesThumb topping="wedge"/> },
      { name: 'YS12. Cheezy Fries (M)',           kw: 'cheese fries', thumb: <FriesThumb topping="cheese"/> },
      { name: 'YS013. Chicken Nuggets (6 pcs).',  kw: 'chicken nuggets', thumb: <NuggetsThumb/> },
      { name: 'YS14. Classic Honey Waffle w/ Ice Cream (2 pcs)', kw: 'waffle ice cream', thumb: <WaffleThumb/> },
    ],
  },
  {
    title: 'BINGSU',
    kw: 'bingsu',
    items: [
      { name: 'CB01. MANGO BINGSU',         thumb: <BingsuThumb mound="#f7d34a"/> },
      { name: 'CB02. WATERMELON BINGSU',    thumb: <BingsuThumb mound="#ffb3b8"/> },
      { name: 'CB03. HONEYDEW BINGSU',      thumb: <BingsuThumb mound="#dff0c0"/> },
      { name: 'CB04. COCONUT BINGSU',       thumb: <BingsuThumb mound="#ffffff"/> },
      { name: 'CB05. LYCHEE BINGSU',        thumb: <BingsuThumb mound="#fbeed2"/> },
      { name: 'CB06. MUSANG KING DURIAN BINGSU', thumb: <BingsuThumb mound="#f0d96a"/> },
      { name: 'CB07. CHOCOLATE OREO BINGSU',
        thumb: <BingsuThumb mound="#3a2418" drip={<g><circle cx="32" cy="46" r="2.5" fill="#1a0f0a"/><circle cx="44" cy="40" r="2" fill="#1a0f0a"/></g>}/> },
      { name: 'CB08. MILO LAVA BINGSU',
        thumb: <BingsuThumb mound="#7a4a14" drip={<path d="M18 56 q 5 -8 10 -2 q 5 6 10 -4 q 5 -6 10 2" stroke="#3a1b08" strokeWidth="1.5" fill="none"/>}/> },
      { name: 'CB09. MIX FRUIT FRUITY BINGSU',  thumb: <BingsuThumb mound="#ffffff" drip={<g><circle cx="32" cy="46" r="2" fill="#c8344a"/><circle cx="38" cy="40" r="2" fill="#f7c948"/><circle cx="44" cy="44" r="2" fill="#a8d96a"/></g>}/> },
      { name: 'CB10. CHOCOLATE FRUITY BINGSU', sub: 'Chocolate ice flavour',
        thumb: <BingsuThumb mound="#7a4a14" drip={<g><circle cx="38" cy="40" r="2" fill="#c8344a"/><circle cx="44" cy="44" r="2" fill="#f7c948"/></g>}/> },
      { name: 'CB11. TUTTI FRUITY BINGSU', sub: 'Mango ice flavour',
        thumb: <BingsuThumb mound="#f7d34a" drip={<g><circle cx="32" cy="46" r="2" fill="#c8344a"/><circle cx="44" cy="40" r="2" fill="#fff"/></g>}/> },
      { name: 'CB12. BLUE YOGURT KITKAT BINGSU',  thumb: <BingsuThumb mound="#b6d9f0"/> },
      { name: 'CB13. SOYA BEAN BINGSU',           thumb: <BingsuThumb mound="#f5e6c0"/> },
      { name: 'CB14. MATCHA BINGSU',              thumb: <BingsuThumb mound="#a8c46a"/> },
      { name: 'CB15. MILK TEA BINGSU',            thumb: <BingsuThumb mound="#d2a878"/> },
      { name: 'CB16. THAI TEA BINGSU',            thumb: <BingsuThumb mound="#e0a86a"/> },
      { name: 'CB17. CHOCOLATE CARAMEL BINGSU',   thumb: <BingsuThumb mound="#4a2818"/> },
      { name: 'CB18. TIRAMISU BINGSU',            thumb: <BingsuThumb mound="#e0c89a"/> },
      { name: 'CB19. RED VELVET CAKE BINGSU',     thumb: <BingsuThumb mound="#c8344a"/> },
      { name: 'CB20. OREO CHEESECAKE BINGSU',     thumb: <BingsuThumb mound="#fdf6e0"/> },
      { name: 'CB21. STRAWBERRY CHEESECAKE BINGSU', thumb: <BingsuThumb mound="#ffd0d0"/> },
      { name: 'CB22. BLUEBERRY CHEESECAKE BINGSU',  thumb: <BingsuThumb mound="#c8c8e8"/> },
      { name: 'CB24. KINDER BUENO BINGSU',          thumb: <BingsuThumb mound="#cca070"/> },
    ],
  },
  {
    title: 'YOOYOO BOWL',
    kw: 'rice bowl',
    items: [
      { name: 'YYB01. YooYoo Bowl', thumb: <BowlThumb/> },
    ],
  },
  {
    title: 'WOORI ICE BLENDED',
    kw: 'smoothie drink',
    items: [
      { name: 'W01. Summer Frutti Ice Blended', sub: 'Mixed with Grapefruit, Peach & Lychee', kw: 'mango smoothie', thumb: <WooriThumb body="#f5a93a"/> },
      { name: 'W02. Tutti Frutti Ice Blended',  sub: 'Mixed with Mango, Passion Fruit & Peach', kw: 'fruit smoothie', thumb: <WooriThumb body="#f0d24a"/> },
      { name: 'W03. Oreo Ice Blended',          kw: 'oreo milkshake', thumb: <WooriThumb body="#7a5a48"/> },
      { name: 'W05. Coffee Ice Blended',        kw: 'iced coffee', thumb: <WooriThumb body="#a4856a"/> },
      { name: 'W06. Local Flavoured Ice Blended', kw: 'matcha smoothie', thumb: <WooriThumb body="#9ed0d6"/> },
    ],
  },
  {
    title: 'YOOYOO EAT',
    kw: 'korean fried chicken',
    items: [
      { name: 'E01. KOREAN CHICKEN WINGETTE & DRUMETTE (6PCS)',   kw: 'korean chicken wings', thumb: <ChickenWingThumb glaze="#c13a1f"/> },
      { name: 'E02. KOREAN CHICKEN WINGETTE & DRUMETTE (10PCS)',  kw: 'korean chicken wings', thumb: <ChickenWingThumb glaze="#c13a1f"/> },
      { name: 'E03. KOREAN CHICKEN WINGETTE & DRUMETTE (16PCS)',  kw: 'korean chicken wings', thumb: <ChickenWingThumb glaze="#c13a1f"/> },
      { name: 'E04. KOREAN POPCORN CHICKEN (ORIGINAL FRIED)',     kw: 'popcorn chicken', thumb: <PopcornChickenThumb glaze="#d97a25"/> },
      { name: 'E05. KOREAN POPCORN CHICKEN (KOREAN SAUCE)',       kw: 'spicy popcorn chicken', thumb: <PopcornChickenThumb glaze="#c13a1f"/> },
      { name: 'E06. KOREAN POPCORN CHICKEN NOODLES',              kw: 'korean noodles chicken', thumb: <NoodleBoxThumb/> },
      { name: 'E07. KOREAN CHICKEN WING NOODLES',                 kw: 'korean ramen chicken', thumb: <NoodleBoxThumb/> },
      { name: 'E08. CHICKEN WING & POPCORN CHICKEN WITH NOODLES', kw: 'korean fried chicken noodles', thumb: <NoodleBoxThumb/> },
    ],
  },
];

// ── photo loader (local images/ folder, SVG fallback) ────────
function FoodImage({ code, fallback }) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (errored || !code) return fallback;
  // Convention: drop product photos in images/<CODE>.jpg|png
  // The component tries .jpg first; swap the extension or add fallbacks here if needed.
  const url = `images/${code}.jpg`;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!loaded && <div style={{ position: 'absolute', inset: 0 }}>{fallback}</div>}
      <img
        src={url}
        loading="lazy"
        alt=""
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        style={{
          width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          opacity: loaded ? 1 : 0, transition: 'opacity 0.25s',
          position: 'relative', zIndex: 1,
        }}
      />
    </div>
  );
}

// ── menu list ─────────────────────────────────────────────────
function MenuItem({ thumb, name, sub, code, noImg }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 18px', background: '#fff',
      borderBottom: '1px solid #f0f0f0',
    }}>
      <div style={{
        width: 86, height: 86, borderRadius: 4, overflow: 'hidden', flexShrink: 0,
        background: '#f5f5f5',
      }}>
        {noImg ? thumb : <FoodImage code={code} fallback={thumb}/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: '#111', fontWeight: 400, lineHeight: 1.35 }}>{name}</div>
        {sub && <div style={{ marginTop: 4, fontSize: 13, color: '#888', fontStyle: 'italic' }}>{sub}</div>}
      </div>
    </div>
  );
}

function MenuSection({ title, items }) {
  return (
    <div style={{ background: '#fff' }}>
      <h2 style={{
        margin: 0, padding: '20px 18px 10px', fontSize: 20, fontWeight: 800,
        color: '#111', letterSpacing: '-0.01em',
      }}>{title}</h2>
      {items.map((it, i) => {
        // Auto-derive image code from name (e.g. "YS01. Oreo Iceyoo" -> "YS01")
        const m = it.name.match(/^([A-Z]+\d+)/);
        const code = it.code || (m ? m[1] : null);
        return <MenuItem key={i} {...it} code={code} />;
      })}
    </div>
  );
}

function PromoBannerFeedVibe() {
  return (
    <div style={{ background: '#efefef', padding: '14px 12px' }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: '20px 18px',
        display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', position: 'relative',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>
        {/* Left: copy */}
        <div style={{ flex: '0 0 54%', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7, background: '#ff7a2a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 7 L12 19 L20 5" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#222', letterSpacing: '-0.01em' }}>FeedVibe</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            Your all-in-one food app
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#666', lineHeight: 1.35 }}>
            Discover, share, and unlock foodie deals!
          </div>
          <button style={{
            marginTop: 12, height: 34, padding: '0 14px', borderRadius: 999, border: 'none',
            background: '#ff7a2a', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 3px 8px rgba(255,122,42,0.3)',
          }}>Get the App</button>
          <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>10K+ foodies · 4.2 rated</div>
        </div>

        {/* Right: phone illustration */}
        <div style={{ flex: 1, position: 'relative', height: 180 }}>
          {/* yellow blob */}
          <svg viewBox="0 0 180 200" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <path d="M30 110 Q 10 60, 60 40 Q 120 20, 150 70 Q 180 130, 140 170 Q 90 210, 50 180 Q 10 160, 30 110 Z" fill="#ffd76a"/>
            {/* dots */}
            <g fill="#444" opacity="0.55">
              <circle cx="22" cy="30" r="1.2"/>
              <circle cx="40" cy="22" r="1.2"/>
              <circle cx="60" cy="14" r="1.2"/>
              <circle cx="18" cy="160" r="1.2"/>
              <circle cx="34" cy="180" r="1.2"/>
            </g>
          </svg>

          {/* phone */}
          <div style={{
            position: 'absolute', left: '20%', top: 10, width: 78, height: 150,
            borderRadius: 12, background: '#fff', border: '3px solid #1a1a1a',
            boxShadow: '0 6px 16px rgba(0,0,0,0.18)', overflow: 'hidden',
          }}>
            <div style={{ background: '#fff', height: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: 4, fontSize: 4 }}>
              <div style={{ height: 8, background: '#fafafa', borderRadius: 2 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                <div style={{ height: 22, background: '#f6dcc0', borderRadius: 2 }} />
                <div style={{ height: 22, background: '#e8c89a', borderRadius: 2 }} />
                <div style={{ height: 22, background: '#d8b07a', borderRadius: 2 }} />
                <div style={{ height: 22, background: '#fbecd0', borderRadius: 2 }} />
              </div>
              <div style={{ height: 14, background: '#fff3e3', borderRadius: 2, marginTop: 4 }} />
              <div style={{ height: 10, background: '#f5f5f5', borderRadius: 2 }} />
              <div style={{ height: 10, background: '#f5f5f5', borderRadius: 2 }} />
              <div style={{ flex: 1 }} />
              <div style={{ height: 18, background: '#fff7ed', borderRadius: 2, border: '1px solid #ffe0c0' }} />
            </div>
          </div>

          {/* fingers holding phone */}
          <svg viewBox="0 0 180 60" style={{ position: 'absolute', left: 0, right: 0, bottom: -4, width: '100%' }}>
            <g fill="#fff" stroke="#1a1a1a" strokeWidth="2" strokeLinejoin="round">
              <rect x="50" y="4" width="14" height="32" rx="6"/>
              <rect x="68" y="0" width="14" height="40" rx="6"/>
              <rect x="86" y="4" width="14" height="34" rx="6"/>
              <rect x="104" y="10" width="14" height="30" rx="6"/>
            </g>
          </svg>

          {/* Like bubble */}
          <div style={{
            position: 'absolute', top: 4, left: '2%',
            background: '#fff', border: '2px solid #1a1a1a', borderRadius: 8,
            padding: '2px 7px', fontSize: 11, fontWeight: 800, color: '#111',
            transform: 'rotate(-8deg)',
          }}>Like!</div>

          {/* Wow bubble */}
          <div style={{
            position: 'absolute', top: 32, right: '-4%',
            background: '#fff', border: '2px solid #1a1a1a', borderRadius: 8,
            padding: '2px 7px', fontSize: 11, fontWeight: 800, color: '#111',
            transform: 'rotate(6deg)',
          }}>Wow!</div>

          {/* % starburst */}
          <svg viewBox="0 0 60 60" style={{ position: 'absolute', left: '-2%', top: 80, width: 44, height: 44 }}>
            <path d="M30 2 l4 8 8-4 0 9 9 0 -4 8 8 4 -8 4 4 8 -9 0 0 9 -8-4 -4 8 -4-8 -8 4 0-9 -9 0 4-8 -8-4 8-4 -4-8 9 0 0-9 8 4z" fill="#ff7a2a"/>
            <text x="30" y="36" textAnchor="middle" fontFamily="Arial Black, sans-serif" fontSize="22" fill="#fff" fontWeight="900">%</text>
          </svg>

          {/* mascot */}
          <svg viewBox="0 0 60 60" style={{ position: 'absolute', right: '-6%', bottom: 6, width: 50, height: 50 }}>
            <circle cx="30" cy="30" r="22" fill="#ff7a2a" stroke="#1a1a1a" strokeWidth="2"/>
            <ellipse cx="22" cy="26" rx="3" ry="4" fill="#1a1a1a"/>
            <ellipse cx="38" cy="26" rx="3" ry="4" fill="#1a1a1a"/>
            <path d="M18 34 Q 30 46, 42 34 Q 42 42, 30 44 Q 18 42, 18 34 Z" fill="#1a1a1a"/>
            <ellipse cx="30" cy="42" rx="5" ry="2" fill="#ff5050"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

function SelectOrderCTA() {
  // Bottom CTA is back to a single full-width button — chat bubble moved
  // up into FloatingActions (top-right corner of the hero banner).
  return (
    <div style={{
      position: 'sticky', bottom: 0, left: 0, right: 0,
      padding: '12px 16px 20px',
      background: 'linear-gradient(to top, rgba(255,255,255,0.97) 55%, rgba(255,255,255,0))',
      zIndex: 8,
    }}>
      <button style={{
        width: '100%', height: 52, borderRadius: 999, border: 'none',
        background: 'linear-gradient(180deg, #ff8a3d 0%, #f47216 100%)',
        color: '#fff', fontSize: 17, fontWeight: 700, letterSpacing: 0.1,
        boxShadow: '0 6px 16px rgba(244,114,22,0.35)', cursor: 'pointer',
      }}>
        Select Order Method
      </button>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────
function OrderPage({ onChatClick }) {
  return (
    <div style={{ position: 'relative', minHeight: '100%', background: '#efefef' }}>
      <div style={{
        height: 240, width: '100%',
        background: 'linear-gradient(180deg, #f97316 0%, #fb9d4b 55%, #fdc792 100%)',
        position: 'relative',
      }}>
        <HeroTopBar />
        <FloatingActions />
      </div>

      <div style={{ marginTop: -16, position: 'relative' }}>
        <RestaurantHeader onChatClick={onChatClick} />
      </div>

      <div style={{ height: 10, background: '#efefef' }} />

      {sections.map((s, i) => (
        <React.Fragment key={s.title}>
          <MenuSection {...s} />
          {s.title === 'WOORI ICE BLENDED' && <PromoBannerFeedVibe />}
          {i < sections.length - 1 && s.title !== 'WOORI ICE BLENDED' && <div style={{ height: 10, background: '#efefef' }} />}
        </React.Fragment>
      ))}

      <div style={{ height: 24, background: '#fff' }} />
      <SelectOrderCTA />
    </div>
  );
}

// ── Layout shell ────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return isMobile;
}

function renderPage(route, onChatClick, chatPanel) {
  if (!route || route === "app/customer-facing-agent") {
    return {
      kind: "phone",
      content: (
        <React.Fragment>
          <OrderPage onChatClick={onChatClick} />
          {chatPanel}
        </React.Fragment>
      ),
    };
  }
  if (route === "app/kitchen-agent")   return { kind: "dashboard", content: <window.KitchenAgentPage /> };
  if (route === "app/inventory-agent") return { kind: "dashboard", content: <window.InventoryAgentPage /> };
  if (route === "summary")             return { kind: "dashboard", content: <window.MarkdownPage file="README.md" title="Summary" /> };
  if (route === "docs/cicd")           return { kind: "dashboard", content: <window.ComingSoonPage what="CI/CD" /> };

  const item = window.findNavItem(route);
  if (item && item.file) return { kind: "dashboard", content: <window.MarkdownPage file={item.file} title={item.label} /> };
  return { kind: "dashboard", content: <window.ComingSoonPage what={item ? item.label : "Page not found"} /> };
}

function App() {
  const [chatOpen, setChatOpen] = React.useState(false);
  const route = window.useHashRoute();
  const isMobile = useIsMobile();

  // Defensive: chat should never be open by default after a layout switch.
  // Without this, an open chat on desktop survives a resize to mobile width.
  React.useEffect(() => {
    if (isMobile) setChatOpen(false);
  }, [isMobile]);

  const chatPanel = <window.ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />;

  // Mobile: always kiosk fullscreen, sidebar + iPhone frame both hidden.
  // fm-mobile (positioned) is the containing block for ChatPanel's absolute
  // positioning so translateY(100%) actually moves it below the viewport.
  if (isMobile) {
    return (
      <div className="fm-mobile">
        <div className="fm-mobile-scroll">
          <OrderPage onChatClick={() => setChatOpen(true)} />
        </div>
        {chatPanel}
      </div>
    );
  }

  // Desktop: sidebar + content area.
  const page = renderPage(route, () => setChatOpen(true), chatPanel);
  return (
    <div className="fm-desktop">
      <window.Sidebar />
      <main className={"fm-main fm-main-" + page.kind}>
        {page.kind === "phone" ? (
          <IOSDevice width={402} height={874}>{page.content}</IOSDevice>
        ) : (
          page.content
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
