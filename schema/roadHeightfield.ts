import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from './index'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { BOUNDARY_WALL_COMPONENT_TYPE, clampBoundaryWallComponentProps, type BoundaryWallComponentProps } from './components'
import { ROAD_COMPONENT_TYPE, clampRoadProps, type RoadComponentProps } from './components/definitions/roadComponent'
import { resolveRoadLocalHeightSampler, createSegmentHeightSampler } from './roadMesh'
import { buildGroundHeightfieldData } from './groundHeightfield'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, type RoadGraph } from './roadGraph'

export type RoadHeightfieldBodiesEntry = { signature: string; bodies: CANNON.Body[] }

export type RoadHeightfieldTileDescriptor = {
	curveIndex: number
	tileIndex: number
	startIndex: number
	endIndex: number
	position: [number, number, number]
	yaw: number
	shapeDefinition: RigidbodyPhysicsShape
}

export type RoadHeightfieldBuildSnapshot = {
	surfaceNode: SceneNode
	tiles: RoadHeightfieldTileDescriptor[]
	groundSignature: string
	heightHash: number
	layoutHash: number
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	desiredTileLength: number
	elementSize: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}

export type RoadHeightfieldBuildParams = {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	groundNode?: SceneNode | null
	world: CANNON.World
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: CANNON.Body } | null
	maxSegments?: number
}
	// RoadHeightfieldBuildParams: 闂傚倷绀侀幖顐︻敄閸涱垪鍋撳鐓庡缂佽鲸鎹囬獮妯肩磼濡厧濮搁梻浣筋潐閸庡啿锕㈤柆宥嗗亜闁告侗鍘欓弮鍫濈＜婵炴番鍩勬禍鐐哄焵椤掑喚娼愬┑鐐诧工閻ｇ兘鎮滈懞銉モ偓缁樹繆椤栨瑨顒熼柡鍡節濮婂宕掑顓狀槺闂佺顑嗛幑鍥蓟濞戞ǚ鏋庨煫鍥ㄦ尨閸嬫捁銇愰幒鎴炶緢闂佺粯鏌ㄩ崥瀣磿瀹ュ鐓曢柡鍥ュ妼瀵劍銇勯顒傜暤闁哄本鐩俊鎼佸Ψ椤旂厧澹堥梻浣风串缁插潡宕戦幘鍓佺煓濠电姴鍟欢鐐烘煕椤愶綀澹樺ù?
	// - roadNode: 闂傚倷绶氬缁樹繆閸ヮ剙纾块柕鍫濇噳閺嬪秵绻涢崱妯哄闁崇粯姊归妵鍕箻鐠虹洅锝夋煟閿濆鎲炬慨濠冩そ椤㈡鎷呴悷鎵級闂備焦妞块崣鍐不閺嶎厼绠犻柣鎰惈绾惧吋绻濇繝鍌氭殨闁告牗鐗犲娲箰鎼达絺妲堥梺鍏兼た閸ㄦ娊鍩€椤掆偓閻忔岸鏁冮姀鐘垫殾闁靛鏅╅弫鍐煏韫囨洖顫戞俊銈呮噺閻撴瑦銇勯幋锝呭姷闁稿繐鐬肩槐鎾愁吋閸滀焦鈻堥悗娈垮枙缁瑩骞婇弽顓炵厸闁告劏鏅滈崕顖氣攽閻戝洨鍒版繛鑼█瀹曟粌鈹戦崶褜鍤?
	// - rigidbodyComponent: 闂傚倸鍊风欢锟犲礈濮樿泛绠插〒姘ｅ亾闁诡垰鏈妶锝夊礃閳轰焦鐤呴梻浣侯焾閺堫剛鍒掔仦鍓ь浄妞ゆ牜鍋為崐鐢告煟閵忕姷浠涢柛銈傚亾缂傚倷闄嶉崝宥夋偂閿熺姴绠氶柛鎰靛枛缁€瀣亜閹扳晛鐏ù鐘櫆缁绘稒娼忛崜褏蓱闂佸湱顭堟晶浠嬪礆閹烘埈鍚嬮柛鈩冪懐濞村嫰姊洪崨濠冨矮缂佲偓娴ｈ櫣鎳呴梻鍌欐祰椤曟牠宕楀☉姘偨闁靛牆娲﹂～鏇熺箾閸℃ɑ灏伴柛瀣ㄥ姂閺屾洘绻涢崹顔瑰亾濡ゅ懏鍤屽Δ锝呭暞閸嬶綁鏌涢妷顔绘喚闁搞倖鐟ч幉?bodyType 缂傚倸鍊烽悞锔剧矙閹次层劑鍩€椤掑倻纾?
	// - roadObject: THREE.Object3D闂傚倷鐒︾€笛呯矙閹寸偟闄勯柡鍐ㄥ€荤粈濠囨煛閸愶絽浜剧紓浣割儏椤︻垳鍙呭銈呯箰閸燁偊藟濮樿埖鐓熼柣妯跨簿椤掔喖鏌涢妸銉ユ毐闁崇粯鎹囬獮瀣晜閽樺鍑介梺鑽ゅЬ濡椼劎鎷冮敃鍌氬惞闁绘绮崑锝夋煟閹存繃宸濈痪鎯ф健閺屸剝鎷呴棃娑掑亾閺嶎偆鐭夌€广儱妫欓崕鐔兼煏韫囨洖啸婵″弶鎮傞弻鈩冨緞鐏炴垝鎴烽梺鍝勬媼閸嬪﹤顕ｉ锕€绠婚悹鍥皺椤撴椽姊鸿ぐ鎺戜喊闁哥姵顨婇幃?tile 闂備浇顕уù鐑藉极閹间降鈧焦绻濋崶銊ョ樁?
	// - groundNode: 闂傚倷绀侀幉锟犳偡椤栫偛鍨傞柛顐ｆ礀閻掑灚銇勯幒鍡椾壕濡炪倧绠戝畷顒勫煝閹捐绠ｉ柨鏇楀亾闁圭懓鐖奸弻鈩冨緞鎼粹€冲Х闂佺硶鏅涢惌鍌炲蓟閵堝浼犻柛鏇ㄥ亐閸嬫挻绻濆顒傦紱闂佹寧绻傞ˇ浼村疾椤掑倵鍋撻崗澶婁壕闂侀€炲苯澧寸€殿噮鍋婃俊鍫曞幢濞嗘ɑ閿ら梺鍦帶閻°劎鎹㈤崟顖涘剹闁靛牆顦伴悡鏇㈡煥閺冨洤袚缂佽埖鐓￠弻銈夋⒐閹邦剙绁梺鍝勮嫰閻倸鐣烽崼鏇炍╃憸宥壦夋惔顫箚闁靛牆鎳庨埀顒€缍婇弫瀣煟?
	// - world: CANNON.World 闂傚倷鑳剁划顖炲Φ濞戙垹鐤炬繝闈涱儏缁犳牕鈹戦悩鎻掓殶闁崇粯妫冮弻鈥愁吋鎼粹€茬凹濠电偛鎳忓ú鐔煎箖濡ゅ懎鎹舵い鎾跺仒缁呯磽娴ｇ晫鍫柛搴ｆ暬瀵偄顓兼径濠囧敹闂侀潧绻嗛崜婵嗏枔閵忥紕绠鹃悗娑欘焽閻﹤螖閻樿櫕鍊愮€规洖缍婂畷锟犳倻閸℃鐣奸梻浣告啞缁诲倻鈧凹鍓熼幃姗€鎮╃憗浣哥秺閺佹劙宕卞Ο娲€烘繝纰夌磿閸嬫盯宕愯ぐ鎺戠闁告侗鍨卞畷澶愭煏婵犲繘妾繛鍫涘灲濮?
	// - createBody: 闂佽姘﹂～澶愬箖閸洖纾块柛妤冨剱閸熷懘鏌涢锝嗙缂佲偓閸曨垱鐓犻柟顓熷笒閸旀粍绻涢崼婵堝煟闁哄被鍔岄埥澶娢熼懖鈺€绱橀梻浣芥〃闂勫秹宕愰弽顐ょ焿鐎广儱妫欓崕鐔兼煥濞戞ê顏╅柡浣靛€栫换娑氣偓娑欘焽閻﹥鎱ㄥ鍫ユ濞ｅ洤锕、姗€濮€閳ユ枼鍋撻柨瀣垫闁绘劘灏欏銊╂煕鐎ｎ偅灏伴柟宄版嚇閹煎綊宕烽鐘插笒婵犵數鍋涢顓熸叏閹€鏋栨繛鎴欏灩缁狀垶鏌熷畡鎷岊潶濞存粌缍婇弻鏇＄疀鐎ｎ亞浠肩紒妤佸灴閺岋絾鎯旈妶搴㈢秷闂佹椿鍙庨崰姘卞垝婵犳碍鍋勯柣鎾虫捣椤︻偄鈹戦悙鏉戠仸妞ゎ厼娲ㄥΣ鎰版晝閸屾稓鍘藉┑锛勫仧缁垰鈻嶉崶顒佺厵?body
	// - maxSegments: 闂傚倷绀侀幉锟犳偡椤栫偛鍨傞柛顐ｆ礀閻掑灚銇勯幒鍡椾壕濡炪倧绠戝畷顒勫煝閹捐绠ｉ柨鏇楀亾閻庢艾顦甸弻宥堫檨闁告挻鑹鹃銉╁礋椤曞懏些闂備焦鎮堕崝灞绢殽閹间礁鐓濋柟鎹愵嚙閸ㄥ倹銇勯幇鍓佺ɑ妞ゆ柨绉瑰濠氬磼濮橆剦浠鹃梺鍛婃⒐濞茬喎鐣烽崫鍕庢棃宕ㄩ鑺ョ彨闁诲骸鍘滈崑鎾绘煃瑜滈崜鐔奉嚕椤愶箑围闁糕剝鐟ú鎼佹煙閸忚偐鏆橀柛銊潐缁傛帒顫滈埀顒勫蓟濞戙垹绠抽柟瀛樼箥閺嗐垽姊烘潪鎵妽闁圭懓娲悰顔锯偓锝庡枛缁犳稒銇勯幒鎴Ч闁宠銈搁弻锝堢疀閹惧墎顔夐梺鎼炲妽婵炲﹪寮?collider
export function isRoadDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is RoadDynamicMesh {
	return Boolean(value && (value as any).type === 'Road')
}
// isRoadDynamicMesh: 缂傚倸鍊烽懗鑸垫叏椤撱垹纾婚柟鍓х帛閻撴洘淇婇妶鍕妽缂佲偓閸喓绠鹃柛顐ゅ枎閻忊晠鏌ｅ顒€鈷旈柟椋庡█閹崇娀顢栭挊澶夊婵＄偛顑呯花鍫曞磻閹剧粯鍋￠柟娈垮枛椤ｆ椽鎮楃憴鍕闁靛牊鎮傚顐㈩吋閸涱垱娈曢梺閫炲苯澧寸€殿噮鍋婃俊鍫曞幢濞嗘ɑ閿ら梺纭呭亹鐞涖儵鍩€椤掆偓绾绢厽瀵奸崼銉︹拺闁告繂瀚禍鐐烘煕濡搫鈷旈柛鎺撳浮楠炲秹顢欓悷棰佸闁荤喐鐟ョ€氼參鎯冮幋鐐电?dynamicMesh 闂傚倷绀侀幖顐も偓姘卞厴瀹曡瀵奸弶鎴犵暰婵炶揪绲藉﹢閬嶅煝?Road 缂傚倸鍊风欢锟犲磻婢舵劦鏁嬬憸鏃堝箖?
// 闂備礁鎼ˇ顐﹀疾濠婂牆钃熼柕濞垮剭?true 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔筋焾妞村摜鈧碍宀搁弻鏇熷緞閸繂顬堥柧浼欑節濮婅櫣绱掑Ο鍝勵潓濠电姭鍋撻柛妤冨亹閺?dynamicMesh 闂傚倷绀侀幉锟犳偡椤栫偛鍨傛い鏍ㄧ〒椤╂煡鏌熼悜妯诲鞍濠殿垰鐡ㄧ换婵囩箾閹傚闂佽崵濮甸崝妤呭窗閺嶎厼钃熼柛鈩冪☉缁犲鏌涢敂璇插箻闁哥偞鎸抽弻锝嗘償閵堝孩缍堥梺娲诲弾閸犳氨鍒掓繝姘亜闁告稑锕ｅ锕€鈹戦悙鏉戠仸缂侇喚濞€瀵劍绂掔€ｎ偆鍘卞┑顔斤供閸撴岸骞戦敐澶嬬厽闁靛繈鍨荤敮娑氣偓鍨緲鐎氭澘鐣烽悢纰辨晣闁绘柨鐨濋崑?

export function collectRoadHeightfieldTileDescriptors(params: RoadHeightfieldBuildParams): RoadHeightfieldBuildSnapshot | null {
	const {
		roadNode,
		rigidbodyComponent,
		groundNode,
		maxSegments,
	} = params

    // collectRoadHeightfieldTileDescriptors: 闂傚倷绀侀幖顐ょ矓閻戞枻缍栧璺猴功閺嗐倕銆掑锝呬壕闂佸搫鑻Λ婵嬬嵁濮椻偓瀹曠兘顢橀悩鍙夋殽闂備浇顕у锕傦綖婢舵劖鍎楁い鏂垮⒔娑撳秹鏌ｉ弬鎸庢喐闁崇粯妫冮獮鏍垝閸忓浜鹃悗鍦閸炲綊姊婚崒娆戣窗闁稿瀚拌棟妞ゆ牗鐔懓璺ㄧ棯閹屽剭濞存粏顫夐妵鍕敃椤愩垹绠崇紓浣筋嚙濡繈寮婚悢纰辨晣鐟滃秹鎮橀懠顒傜＜?
    // 闂備浇宕垫慨宕囨閵堝洦顫曢柡鍥ュ灪閸嬧晛鈹戦悩铏殤鐎规挷绶氶弻銈囩矙鐠恒劋绮甸梺鍝勬－娴滎亜顫忔繝姘耿婵°倓绶″Λ銈夋⒑鏉炰即妾烽柛濠冪墱缁顓奸崱妯哄妳闂侀潧绻嗛幊鍥磻閹炬椿鏁嶆慨妯煎帶濞堟ê鈹戦悙鍙夆枙濞存粎鍋犻妵鎰邦敍閻愯尙顔愰柡澶婄墕婢т粙鎮炬潏銊х瘈鐟滃宕戦幘缁樷拺闁告稑锕ょ粭姘舵煟椤撗冩灓缂佽京鍋熼埀顒婄秵閸犳宕?tile 闂傚倷鑳堕、濠囶敋瑜忛幑銏犖旈崨顓㈠敹濡炪倕绻愬Λ娑氱不閺冨牊鐓ラ柡鍥殔娴滈箖姊洪崜鑼帥濞存粎鍋ら獮鍐╁閺夋嚦鈺呮煥濠靛棗鈧憡绂?
    // 闂備礁鎼ˇ顐﹀疾濠婂牆钃熼柕濞垮剭濞差亜鍐€妞ゆ挾鍋熼敍娆撴⒒閸屾艾鈧藟閹邦喚鐭?RoadHeightfieldBuildSnapshot 闂?null闂傚倷鐒︾€笛呯矙閹达附鍋嬮柛鈩冪懅缁€濠囨倵閿濆骸鏋涚紒顐㈢Ч閺岋絽螣閾忕櫢绱為梺闈涙閿曨亪寮婚敍鍕ㄥ亾閿濆簼绨绘い蹇婃櫇缁辨捇宕掑☉娆忕３閻庢鍣崰姘跺箯鐎ｎ喖鎹舵い鎾跺濡叉挳姊?

	if (!isRoadDynamicMesh(roadNode.dynamicMesh)) {
		return null
	}
	const definition = roadNode.dynamicMesh
	if ((rigidbodyComponent.props as RigidbodyComponentProps | undefined)?.bodyType !== 'STATIC') {
		return null
	}

    // 闂傚倷绀侀幉锟犳偡椤栨稓顩叉繝濠傜墱閺佸銇勯弴妤€浜惧┑鈽嗗亜閸燁偊鍩㈡惔銊ョ疀闁靛鍎版竟鏇熺箾鏉堝墽鎮兼い顓炵墦閹﹢鎮╃憗浣哥秺閺佹劙宕卞Ο璇插壍缂傚倷娴囨ご鎼佸煘瀹ョTIC闂傚倷鐒︾€笛呯矙閹次诲洭鏌嗗鍛€梺瑙勫礃椤曆呯不閿濆鐓欓柣妤€鐗嗛ˉ瀣喐闁箑鐏︽鐐寸墬濞煎繘宕滆閺嗙姴鈹戦悩娆屽亾闁稿鎸剧槐鎺楁倷椤掆偓椤ュ顭胯椤ㄥ﹪鐛幇鏉跨闁圭偓娼欓鎾绘⒑閻熸壆浠㈤悗姘煎櫍閻涱噣濮€閵堝棛鍘遍梺鍝勫€介褎淇婃禒瀣厓鐟滄粓宕楀☉銏″€块柨鏇炲€搁崹鍌炴煏婵犲繘妾ù婧垮€濋弻鐔兼焽閿曗偓婢ь喚鎮悢鍏肩厽閹兼番鍨归崰鏇犵磼閻樺啿鐏寸€规洖缍婇幃褔宕奸悢濂夆偓鎾绘⒑鐟欏嫬绀冮悘蹇旂懇閹嘲鈹戦崱鈺冨數闁荤姴鎼幖顐︻敂椤愶附鐓?

	const roadState = roadNode.components?.[ROAD_COMPONENT_TYPE] as
		| SceneNodeComponentState<RoadComponentProps>
		| undefined
	const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined)
	const roadWidth = Math.max(0.01, Number.isFinite(roadProps.width) ? roadProps.width : 2)
	const collisionWidth = roadWidth
	const samplingDensityFactor = roadProps.samplingDensityFactor ?? 1.0
	const smoothingStrengthFactor = roadProps.smoothingStrengthFactor ?? 1.0
	const minClearance = roadProps.minClearance ?? 0.01
	const junctionSmoothing = roadProps.junctionSmoothing ?? 0
	const snapToTerrain = roadProps.snapToTerrain
	const heightSampler = groundNode ? resolveRoadLocalHeightSampler(roadNode, groundNode) : null

    // 婵犵妲呴崑鍛熆濡皷鍋撳鐓庡⒋閽樻繈鏌嶉崫鍕櫤闁稿濞€閺屾盯鍩勯崘顏佹）婵犮垼顫夊ú鐔煎箖鐟欏嫮鐟规い鏍ㄦ皑娴犫晠姊哄ú璇蹭簼闁挎洏鍨介悰顕€鍩€椤掑倹鍠愭繝闈涚墛椤洟鏌熷▓鍨灀闁稿鎸惧☉鐢稿川椤曞懏顥夐梺璇叉唉椤绻涙繝鍐х箚閻庢稒顭囬悷褰掓煃瑜滈崜鐔风暦閾忣偄顕遍柡澶嬪灥閸炪劑鎮楅悷鏉款仾濠㈢懓妫楀嵄闁哄洢鍨圭粻褰掑级閸喎绀冪紒鈧€ｎ喗鐓冪憸婊堝礂濞戞氨鐭嗗〒姘ｅ亾闁哄矉绠撻崺鈩冪瑹閸モ晛寮抽梻浣烘嚀閻°劎鎹㈤崒婊勫床濞撴埃鍋撴鐐寸墬濞煎繘骞戦幇顕呮Ч闂備線鈧偛鑻崢鎼佹煟閹虹偟鐣遍柕鍡樺浮瀹曟粍鎷呮搴″⒕闂傚鍋勫ú锕傚箰缁嬪簱鏋嶇€广儱娲ㄧ壕濂告倶閻愭彃缍栭柤鍓蹭邯閺屽秷顧侀柛蹇旂☉椤啴骞掗幋顓熷兊闂佹寧娲栭崐鎼佹儗濡も偓椤法鎹勯悮鏉戜紣缂傚倸绉甸幐濠氥€冮妷鈺傚€烽柤鍝ユ暩瑜把呯磽娓氬洤娅欏┑鈥虫川閸?
    // heightSampler: 闂佽崵鍠愮划搴㈡櫠濡ゅ懎绠伴柡鍕箞娴滅懓霉閿濆懏璐￠柣?groundNode 闂傚倷绀侀幖顐﹀疮閹剁瓔鏁婇柟閭﹀枟椤洘绻濋棃娑卞剱闁稿鍔戦弻鏇熺節韫囨稒顎嶉梻鍌氬缁夋挳婀侀梺缁樕戦悡锟狀敁濡や胶绡€闁逞屽墰婢规洜鈧絻鍔嬪Ч妤呮⒑闂堟稓绠為柛濠冩礀閳诲秴顫濋懜鐢靛幐閻庡箍鍎卞ú銈夊储閹绢喗鐓熸繝鍨姇閺嬬喖鏌熼娑欘棃闁轰礁鍊块幃娆擃敆閸屾稒顔忛梻鍌欑閹诧繝宕归崗鍏煎弿闁靛牆顦Ч?

	const graph = buildRoadGraph(definition)
	if (!graph) {
		return null
	}

    // 闂備浇顕х换鎰崲閹邦儵娑樷攽閸モ晩娲搁梺鍛婃寙閸曨偆锛忔俊鐐€栭悧妤冨垝瀹ュ鍋╅梺顒€绉甸悡鏇㈡煛閸屾繍鍤欏┑鈥茬矙閺屽秷顧侀柛蹇旂洴閹虫宕滄担铏诡槸婵犮垼鍩栭崝鏇㈠礃閳ь剟姊洪悡搴㈣础濠⒀勵殘缁﹪顢欑亸鏍潔闂佽宕樺▍鏇㈠箚閸喓绠鹃悗娑欙供閻掔晫绱掓潏銊ユ诞妤犵偞顭囬埀顒傛暩绾爼宕戦幘娲绘晬闁绘劕鐡ㄥ▍鏍⒑閸撴彃浜栭柛搴灦閸┾偓妞ゆ巻鍋撻柨鏇ㄤ邯楠?+ 闂備浇宕垫慨宕囨媰閿曞倸鍨傞柟娈垮枟椤愪粙鏌ｉ幇顔煎妺闁哄拋鍓欓…鍧楁嚋閻㈢偣鈧帞绱掗埀顒佸緞婵炴帒缍婇幃鈺咁敊閻撳骸顫掔紓鍌欑閼活垶鎮ユ總鍝ュ祦闁归偊鍘肩欢鐐烘倵閿濆骸浜伴柡浣圭矌缁辨挻鎷呴悷鏉垮Б闂佽绻戠换鍫濈暦鐟欏嫭鍎熼柍閿亾闁哄鏌ㄩ湁闁挎繂鎳庨弳鐔虹磼閻樺樊鐓奸柟顔挎硾閳藉螣閼测晛濮遍梻渚€娼荤徊濂稿础閸愬樊鍤?

	// If per-segment heights are present, build a segment-based sampler and
	// let subsequent curve sampling use it. Otherwise fall back to runtime sampler.
	let serializedSampler: ((x: number, z: number) => number) | null = null
	if (Array.isArray((definition as any).segmentHeights) && Array.isArray(definition.segments)) {
		const rawSegments = Array.isArray(definition.segments) ? definition.segments : []
		const sanitizedSegments: Array<{ a: number; b: number; segmentIndex: number }> = []
		for (let i = 0; i < rawSegments.length; i += 1) {
			const seg = rawSegments[i]
			const a = Number((seg as any)?.a)
			const b = Number((seg as any)?.b)
			if (!Number.isInteger(a) || !Number.isInteger(b)) continue
			if (a < 0 || b < 0 || a >= graph.vertices.length || b >= graph.vertices.length) continue
			sanitizedSegments.push({ a, b, segmentIndex: i })
		}
		const tmpBuild: any = { vertexVectors: graph.vertices, paths: [], sanitizedSegments }
		serializedSampler = createSegmentHeightSampler(tmpBuild, (definition as any).segmentHeights)
	}

    // 婵犵數濮烽。浠嬪焵椤掆偓閸熷潡鍩€椤掆偓缂嶅﹪骞冨Ο璇茬窞闁归偊鍓涢宀勬⒑瑜版帒浜板ù婊呭仦濞煎寮Λ鐢垫嚀椤劑宕橀埡濠冿紒闂佽楠搁悘姘卞垝瀹€鍕厺闁瑰墽绮崑銊╂煕椤垵浜為柡鍡欏У娣囧﹪濡堕崨顓涘亾瑜版帗鏅梺璇叉唉椤绻涙繝鍥ф瀬鐎广儱顦柨銈夋煟瑜忛悧鈺〆ntHeights闂傚倷鐒︾€笛呯矙閹次层劑鍩€椤掑倻纾奸弶鍫涘妿缁犵偟鈧娲橀懝楣冨煝鎼淬劌绠涙い鏃傛嚀娴滅偓銇勯弽銊ュ毈闁搞倕鐗撳鍫曟倷閺夋埈妫嗗銈呯箰瀹曨剟鍩ユ径鎰闁告剬鍛晨闂備胶绮弻锟犲磻閹惧绠鹃悗娑欘焽閻﹪鎮楀☉鎺撴珚妞ゃ垺鐟ラ悾婵嬪礋椤掆偓閸擃參姊洪崨濠冨闁搞劍婢橀埢宥咁潩閼哥數鍘搁悗骞垮劚閹冲骸危缂佹绠鹃柛娑卞枛濞搭喖鈹?
    // 闂備浇宕垫慨鏉懨洪姀銈呯？闁汇垻顭堥梻顖毭归崗鍏肩稇闁告劏鍋撻柣搴ｆ嚀鐎氼喗鏅跺Δ鍛仧闁靛牆鎮胯ぐ鎺戠闁艰婢橀ˉ婵嬫⒑缂佹ɑ鐓涢柛瀣尰缁绘稓鈧稒顭囬惌濠偽旈悩铏€愮€规洘鐟╅崺鍕礃閳轰礁濡抽梻濠庡亜濞诧箓骞愰幖浣瑰€舵繛鍡樻尰閻撴洟鏌″鍐ㄥ濠⒀嗛哺缁绘盯宕奸悢椋庝淮闂佸磭绮幑鍥箖娴犲浼犻柕澶堝劥閹奉偊姊虹涵鍛棈闁规椿浜浠嬪礋椤栨碍杈堥梺缁樻⒒閸樠呯不閸欏浜滈柡鍐ㄥ€告禍鍓х磼缂併垹鐏﹂柡宀€鍠栭獮渚€骞掗幋婵喰撶紓鍌欒兌缁垶宕归崹顔炬殾闁割偅娲橀崐鐑藉级閻愬瓨绶叉い銉﹀哺閺岋綁鎮╂潏顐妳闂佹悶鍔庨弫缁樹繆閹绢喖绀冩い鏃傜摂濡啴姊洪棃娑氱疄闁稿﹥顨夐妵鎰邦敍閻愯尙顔愰柡澶婄墛瀹曟﹢顢橀搹鍦＜?
    // 婵犵數鍋涢顓熸叏閺夋埈娼╅柨鏇炲€搁悞鍨亜閹哄棗浜鹃梺娲诲幖閸婂湱鈧潧銈搁崺锟犲川椤撶媭妲柣搴＄畭閸庨亶鎮ц箛鏇犱笉闁靛鏅滈崑鐘崇箾閹寸倖鎴濓耿閻楀牅绻嗛柣鎰絻閳ь剙鐏濋悾宄拔熸笟顖氭倯闂佸憡渚楅崢楣冾敊瀹€鍕拻濞达絿鎳撶徊缁樼箾鐠囇呯暤闁诡啫鍥ㄧ劶鐎广儱鎳忓畵宥夋⒑閸濆嫷妲奸柛搴☆煼瀹曞搫鐣濋崟顒傚幍闁诲孩绋掗…鍥ㄦ櫠椤忓牊鐓曟繛鍡樺灥娴滃墽绱掗崒娑樻诞鐎殿喖鈧噥妲婚悶姘卞枛濮婅櫣鎷犻垾鍐插箰闂佺粯甯粻鎴︹€﹂崶顒侇棃婵炴垶甯楅弫鐘绘⒑鐟欏嫬顥愰柡鍌欑窔瀹?
	const roadSurfaceHeightSampler = serializedSampler
		? serializedSampler
		: snapToTerrain
			? heightSampler
			: (_x: number, _z: number) => 0
	if (!roadSurfaceHeightSampler) {
		return null
	}

    // roadSurfaceHeightSampler 闂傚倷绀侀幖顐︽偋閸愵喖纾婚柟鎯у绾捐棄霉閿濆懏鎲稿褎姊荤槐鎺楀矗濡搫绁悗娈垮枙閸楁娊銆佸☉姗嗘僵闁稿繐鍚嬮幃娆忊攽閻愭潙鐏﹂柟鍛婃倐椤㈡牠宕熼鐘电暥婵炴挻鍩冮崑鎾绘煙閾忣偅宕岀€规洏鍔戦、妤呭磼閵堝懏鍊涙繝鐢靛仦閸ㄥ爼骞愰幘顔肩；闁瑰墽绮悡?
    //  - serializedSampler: 闂佽娴烽幊鎾诲箟闄囬妵鎰板礃椤忓洤小濡炪倖鎸堕崹鍦矆閸℃ü绻嗛柕鍫濆€告禍楣冩煟鎼达紕浠涢柣鎿勭節楠炲棝宕橀鑲╊槹濡炪倖宸婚崑鎾绘煟閿斿墽甯涚紒缁樼洴瀹曞ジ濮€閳╁啯鐦撻梻浣虹帛缁诲秹宕板Δ鍛畾闁哄啫鐗婇弲婵嬫煕鐏炲墽顣查柣婵呭嵆濮婃椽宕崟顓夈垽鏌涢姀鈥崇祷闁宠绉归獮鎺懳旀担瑙勭彨闂備礁澹婇崑鍛垝鎼淬劌绐楁慨妞诲亾闁哄本绋栫粻娑㈠箻鐠鸿　鎷紓?
    //  - heightSampler: 婵犵數鍋涢顓熸叏鐎涙﹩娈界紒瀣皡閼拌法鐥幆褜鍎嶅ù婊冪秺閺屾洝绠涚€ｎ亖鍋撻弴鐐╂瀺婵鍩栭悡娑氣偓骞垮劚椤﹁棄螞閹寸偟绠鹃柛顐ゅ枎閻忓鈧娲橀悷鈺呭箠閻愬搫唯闁挎梻鐡旈崯鈧梻鍌欑劍鐎笛呯矙閹达附鍋嬮柛鈩冪懅缁€?snapToTerrain 婵?true闂?
    //  - 闂傚倷娴囬鏍储閻ｅ本鏆滃┑鐘插鐎?0 闂傚倷鐒﹂惇褰掑礉瀹€鈧埀顒佺煯閸楀啿鐣烽搹顐㈩嚤闁哄鍨甸崬銊╂倵閻熸澘顏褎顨婇幃鐢稿Χ婢跺鍙嗗┑鐐村灦椤洦鏅堕敐澶嬪€垫慨妯稿劚閻忣亞绱掔€ｎ亶妲告い鎾炽偢瀹曨亝鎷呴崨濠庡晠婵犳鍠楃敮鐐靛垝椤栫偛绀夐柡鍥╁剳閼拌法鐥幆褜鍎嶅ù婊嗩潐閵囧嫰顢曢銏犵闂佽崵鍣ラ崜鐔煎蓟閿熺姴绀冩い蹇撳珔閿濆棎浜滈柡鍌涘濠€鐗堛亜閵娿儲鎼愰摶锝夋煕濠靛棗顏撮柛鐐存そ濮婄儤娼幏灞藉帯婵犫拃鍕垫當闁伙絽鐏氱粭鐔煎焵椤掑嫬鏋?

	const boundaryWallComponent = roadNode.components?.[BOUNDARY_WALL_COMPONENT_TYPE] as
		| SceneNodeComponentState<BoundaryWallComponentProps>
		| undefined
	const boundaryWallEnabled = boundaryWallComponent?.enabled !== false && Boolean(boundaryWallComponent)
	const boundaryWallProps = boundaryWallEnabled
		? clampBoundaryWallComponentProps(boundaryWallComponent?.props as Partial<BoundaryWallComponentProps> | null | undefined)
		: null
	const surfaceNode = boundaryWallEnabled
		? {
			...roadNode,
			components: Object.fromEntries(
				Object.entries(roadNode.components ?? {}).filter(([type]) => type !== BOUNDARY_WALL_COMPONENT_TYPE),
			),
		}
		: roadNode
	const curves = buildRoadCurvesFromGraph(junctionSmoothing, graph)
	if (!curves.length) {
		return null
	}

    // boundaryWallEnabled: 闂傚倷绀侀幉锛勬暜閸ヮ剙纾归柡宥庡幖閽冪喖鏌涢妷顔煎闁告瑥锕ラ妵鍕冀閵娧屾殹闂佺楠搁敃顏堝蓟濞戞﹩娼╅柣鎾虫捣娴狀垶姊烘潪浼存闁稿﹥鐗滅划瀣吋婢跺﹤鑰垮┑顔筋焾娴滎剝銇愭ィ鍐┾拺濞村吋鐟ч崚浼存煠濞茶鐏﹂柕鍡楀€垮畷婊嗩槾缁炬儳銈搁弻娑㈠即閵娿倗鍑瑰銈嗗姃缁瑩寮婚妸銉㈡婵☆垰鐏濋顓烆渻閵堝倹鏆橀柛銉戝啫娈ゆ繝鐢靛Т閿曘倝宕鐐茬？婵炲棙鎸婚悡鐔搞亜椤愵偄澧┑鈥炽偢閺屾盯鈥﹂幋婵堜化闂佸綊顥撴慨鐑藉箯閻樿绠甸柟鐑樻⒐閸嬔囨⒒娴ｄ警鐒剧紒缁橆殔閳绘柨鈽夐姀鈥冲壍濠殿喗銇涢崑鎾搭殽閻愨晛浜鹃柣鐔哥矊缁夊綊骞婇悢鍏煎亜闁绘挸瀛╁畵?surfaceNode 婵?
    // 缂傚倸鍊风粈渚€藝椤栫偐鈧箑鐣￠幍铏€?boundary wall 缂傚倸鍊搁崐椋庣矆娴ｈ　鍋撳闂寸盎闁宠閰ｆ慨鈧柕鍫濇濞呮牠姊洪崜鎻掍簴闁搞劍妞藉瀹犵疀閹句胶鎳撻…銊╁礃椤曞應鍋撳Δ鍛厵妞ゆ梻鐡斿▓妯肩磼鏉堛劌娴い銏★耿閹晠鎼归锝庝户闂?collider 闂傚倷绀侀幖顐﹀疮閸愭祴鏋栨繛鎴炲殠娴滃湱鎲搁弮鍫濈疇闁规崘顕х粈鍐┿亜閹捐泛娅忛柍褜鍓氬畝绋款潖濞差亶鏁嗗ù锝囨嚀绾锯晠姊哄ú璇插箹濠⒀傜矙楠炲啯瀵奸弶鎳斥晠鏌嶉崫鍕偓褰掑Υ閸愵喗鈷戦柛婵嗗婢ч亶鏌涢幘瀵哥疄婵☆偄鎳橀崺锟犲川椤旇姤鐝?
    // buildRoadCurvesFromGraph: 闂備浇顕х换鎰崲閹邦儵娑樜旈埀顒勬箒濠碘槅鍨甸崑鎰婵傚憡鐓欓柟顖嗗苯娈堕梺閫炲苯澧婚柛銊ュ船椤洭顢旈崼顐ｆ櫌婵炶揪绲块…鍫㈣姳閵夛妇绠鹃柟瀵稿仦瀹曞嫭淇婂鐓庡缂侇喒鏅濋埀顒勬涧閹芥粎澹曟總鍛婄厱闁哄洢鍔屾禍浼存煙閸撴彃澧紒缁樼箖缁绘繈宕橀妸褌妗撴繝鐢靛仦瑜板啴骞楀鍫熷剦妞ゅ繐鐗嗙粈宀勬煥濞戞ê顏い锔规櫊濮婂搫煤缂佹ê鈻忛梺鍛婃煥椤戝洭鎳為柆宥庢晢闁告洦鍋嗛鍥ㄧ節閵忥絾纭炬い鎴濇閺屻劑濡堕崶鈺冿紲闂佽鍨庨崨顒冩闂備焦鎮堕崝灞绢殽閹间礁鐓濋柟鍓х帛閸嬨劎绱掔€ｎ偄顕滈柣婵呭嵆濮婃椽宕崟顓夈垽鏌涢妶鍡欏⒈婵?

	const hasSegmentHeights = Boolean(serializedSampler)

	const desiredTileLength = clampNumber(roadWidth * 8, ROAD_HEIGHTFIELD_MIN_TILE_LENGTH, ROAD_HEIGHTFIELD_MAX_TILE_LENGTH, ROAD_HEIGHTFIELD_DEFAULT_TILE_LENGTH)
	const maxBodies = typeof maxSegments === 'number' && Number.isFinite(maxSegments)
		? Math.max(1, Math.trunc(maxSegments))
		: 128

    // 闂備浇宕垫慨宕囨閵堝洦顫曢柡鍥ュ灪閸嬧晛鈹戦悩宕囶暡闁稿鍊濋弻銊╁籍閳ь剟宕曢幎濮愨偓鍌涚節濮橆厾鍙嗗┑鐐村灦钃辩紒鍓佸壘le闂傚倷鐒︾€笛呯矙閹次诲洭宕￠悘鏄忣潐瀵板嫰骞囬鍌ゆН闂備礁鎲￠崝鏍亹閸愩剮娑橆潨閳ь剟寮婚埄鍐╁缂佸娉曢惄搴ｇ磽娴ｇ缍侀柛妤€鍟块锝夋偨閸涘﹤浜滈梺鍛婄☉閿曪箓顢欓弽顓熲拺闁绘垟鏅滈～澶娾攽閳ヨ櫕澶勯柡鍛埣瀵粙顢橀悢鍙夊闂備礁澹婇悡鍫ュ窗閺嶎収鏁婂┑鐘叉处閻撳繘鏌涢埄鍐╃闁告柨绉归弻锝夋晜閼测晝鐦堥梺璇″枟濡炰粙寮崒鐐茬畾鐟滄粓寮抽鍕拺婵懓娲ゆ俊濂告倵濮樼厧鏋ょ紒杈╁仦瀵板嫰骞囬鈧崬銊╂⒑閻撳海绉洪柛瀣躬瀵劍绂掔€ｎ偆鍘告繛杈剧悼椤牏鑺遍懡銈囩＜閺夊牄鍔庨幊鍥煙椤栨艾顏い銏＄懇閹墽浠﹂悾灞肩礃闂傚倷鐒︾€笛呯矙閹次层劑鍩€椤掑倻纾奸弶鍫涘妿缁犳牜绱掗崒娑樻诞濠碉紕鍏樻俊鐑藉Ψ閿曗偓閻ㄣ劑姊绘担渚劸缂佺粯鍔欏畷顖炲箥椤斿墽鐒奸悗鍏夊亾闁逞屽墯缁傚秹骞栨担闀愮炊闂佸憡娲熷褍鈻?
    // elementSize 闂傚倷鐒﹀鍨焽閸ф绀夐悗锝庡墲婵櫕銇勯幒鎴濐仼闁告垹濞€閺屾盯寮撮妸銉ょ敖缂備焦鍞荤粻鎴ｇ亙闂佺鏈懓浠嬵敂閸″繐浜鹃悷娆忓閳绘洜鈧娲滈崗姗€骞栬ぐ鎺戞嵍妞ゆ挾濮岃濮婃椽宕崟顓夈垽鏌涘顒夊剰妞ゎ亜鍟村畷鎺楁倷閸欏绁堕梻渚€娼ч…鍫ュ磿闁禋鐑藉川鐎涙鍘卞┑顔斤供閸樺ジ鎮橀敃鍌涚厸鐎光偓閳ь剟宕伴弽褏鏆﹂柕澶嗘櫅缁狅絾绻濇繝鍌涘櫧闁瑰樊浜鍝勑ч崶褍顬堥柣搴㈢煯閸楀啿鐣烽搹顐㈩嚤闁哄鍨甸崬銊╂⒑缂佹ê鐏卞┑顔哄€濋弫宥夋偄閸忕厧浠?

	let totalBodies = 0
	const tiles: RoadHeightfieldTileDescriptor[] = []
	let signatureHash = 0
	let layoutHash = 0
	let representativeDesiredTileLength = desiredTileLength
	let representativeElementSize = Math.max(1e-4, desiredTileLength / ROAD_HEIGHTFIELD_MAX_ROWS)

	let curveIndex = 0
	for (const descriptor of curves) {
		if (totalBodies >= maxBodies) {
			break
		}
		const curve = descriptor.curve
		const subsegments = collectRoadCurveSubsegments(curve)
		let segmentIndex = 0
		for (const segment of subsegments) {
			if (totalBodies >= maxBodies) {
				break
			}
			const length = segment.getLength()
			if (!(length > 1e-6)) {
				segmentIndex += 1
				continue
			}
			const geometryDetail = computeCurveGeometryDetailScore(segment, length)
			const divisions = computeRoadDivisionsForCurve(segment, length, samplingDensityFactor, junctionSmoothing, geometryDetail)
			if (divisions < 2) {
				segmentIndex += 1
				continue
			}
			const smoothedHeights = buildRoadCenterlineHeightSeries({
				curve: segment,
				divisions,
				heightSampler: roadSurfaceHeightSampler,
				minClearance,
				smoothingStrengthFactor,
				smooth: !hasSegmentHeights,
			})
			const heightDetail = computeRoadHeightDetailScore(smoothedHeights, length)
			const heightRange = computeRoadHeightRange(smoothedHeights)
			const samplingDetail = Math.max(0, Math.min(1, geometryDetail * 0.15 + heightDetail * 0.85))
			const densityScale = Math.max(0.35, Math.min(1.5, Math.sqrt(clampNumber(samplingDensityFactor, 0.1, 10, 1.0) / 3.5)))
			const targetRows = Math.max(
				ROAD_HEIGHTFIELD_MIN_ROWS,
				Math.min(ROAD_HEIGHTFIELD_MAX_ROWS, Math.round((ROAD_HEIGHTFIELD_MIN_ROWS + samplingDetail * (ROAD_HEIGHTFIELD_MAX_ROWS - ROAD_HEIGHTFIELD_MIN_ROWS)) * densityScale)),
			)
			const desiredTileLengthForCurve = clampNumber(
				roadWidth * lerpNumber(16, 8, geometryDetail),
				ROAD_HEIGHTFIELD_MIN_TILE_LENGTH,
				ROAD_HEIGHTFIELD_MAX_TILE_LENGTH,
				desiredTileLength,
			)
			const elementSize = Math.max(1e-4, desiredTileLengthForCurve / targetRows)
			if (curveIndex === 0 && segmentIndex === 0) {
				representativeDesiredTileLength = desiredTileLengthForCurve
				representativeElementSize = elementSize
			}
			layoutHash = (layoutHash * 31 + Math.round(geometryDetail * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(heightDetail * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(heightRange * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + targetRows) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(desiredTileLengthForCurve * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(elementSize * 1000)) >>> 0
			smoothedHeights.forEach((value) => {
				const normalized = Math.round((Number.isFinite(value) ? value : 0) * 1000)
				signatureHash = (signatureHash * 31 + normalized) >>> 0
			})

			const spans = collectRoadCollisionSpans(segment, divisions, smoothedHeights)
			const spanP0 = new THREE.Vector3()
			const spanP1 = new THREE.Vector3()
			const spanForward = new THREE.Vector3()
			const spanCenter = new THREE.Vector3()
			let tileIndex = 0
			for (const span of spans) {
				if (totalBodies >= maxBodies) {
					break
				}
				const startU = span.startIndex / divisions
				const endU = span.endIndex / divisions
				segment.getPoint(startU, spanP0)
				segment.getPoint(endU, spanP1)
				spanForward.copy(spanP1).sub(spanP0)
				const forwardLen = Math.hypot(spanForward.x, spanForward.z)
				let yaw = 0
				if (forwardLen > ROAD_EPSILON) {
					yaw = Math.atan2(spanForward.x, spanForward.z)
				} else {
					const midU = (startU + endU) * 0.5
					const tangent = segment.getTangent(midU)
					yaw = Math.atan2(tangent.x, tangent.z)
				}
				spanCenter.copy(spanP0).add(spanP1).multiplyScalar(0.5)
				const spanLength = Math.max((span.endIndex - span.startIndex) * (length / divisions), forwardLen)
				layoutHash = (layoutHash * 31 + curveIndex) >>> 0
				layoutHash = (layoutHash * 31 + segmentIndex) >>> 0
				layoutHash = (layoutHash * 31 + tileIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.startIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.endIndex) >>> 0
				layoutHash = (layoutHash * 31 + (span.kind === 'box' ? 1 : 2)) >>> 0
				if (span.kind === 'box') {
					const spanHeights = smoothedHeights.slice(span.startIndex, span.endIndex + 1)
					const boxShape = buildRoadRectangularTileShapeFromSeries({
						roadWidth: collisionWidth,
						length: spanLength,
						heights: spanHeights,
					})
					if (!boxShape) {
						continue
					}
					const surfaceHeight = spanHeights.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / spanHeights.length
					const boxHalfY = boxShape.kind === 'box' ? boxShape.halfExtents[1] : 0
					tiles.push({
						curveIndex,
						tileIndex,
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						position: [spanCenter.x, surfaceHeight - boxHalfY, spanCenter.z],
						yaw,
						shapeDefinition: boxShape,
					})
				} else {
					const rows = Math.max(2, Math.ceil(spanLength / elementSize))
					const fieldShape = buildHeightfieldShapeFromSeries({
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						rows,
						elementSize,
						roadWidth: collisionWidth,
						heights: smoothedHeights,
					})
					if (!fieldShape) {
						continue
					}
					tiles.push({
						curveIndex,
						tileIndex,
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						position: [spanCenter.x, 0, spanCenter.z],
						yaw,
						shapeDefinition: fieldShape,
					})
				}
				totalBodies += 1
				tileIndex += 1
			}
			segmentIndex += 1
		}
		curveIndex += 1
	}

	if (!tiles.length) {
		return null
	}

	const groundData = groundNode && (groundNode.dynamicMesh as any)?.type === 'Ground'
		? buildGroundHeightfieldData(groundNode, groundNode.dynamicMesh as any)
		: null
	const groundSignature = groundData?.signature ?? 'none'
	return {
		surfaceNode,
		tiles,
		groundSignature,
		heightHash: signatureHash,
		layoutHash,
		roadWidth,
		collisionWidth,
		samplingDensityFactor,
		smoothingStrengthFactor,
		minClearance,
		junctionSmoothing,
		desiredTileLength: representativeDesiredTileLength,
		elementSize: representativeElementSize,
		boundaryWallEnabled,
		boundaryWallProps,
	}
}

// 闂備礁鎼ˇ顐﹀疾濠婂牆钃熼柕濞垮剭濞差亜鍐€妞ゆ挾鍋熼敍娆撴⒑閻撳海绉洪柛瀣躬瀹曢潧鈽夐姀锛勫幐闂佸憡娲﹂崑鍕吹鏉堚晝纾奸弶鍫氭櫆閻濇攼adHeightfieldBuildSnapshot 闂傚倷绀侀幉锟犳偋閺囥垹绠犻幖娣妼缁犳岸鏌涢銈呮灁妞も晜鐓￠弻娑㈠焺閸愬墽鍔烽梺閫炲苯澧婚柛銊ゅ嵆椤㈡艾鈻庡婵囨そ椤㈡棃宕卞Δ鍕闂備胶顢婃竟鍫ュ箵椤忓棛涓嶉柟瀛樼妇閺€锕傛煃瑜滈崜鐔煎蓟閻斿搫鏋堟俊顖濇〃婢规洟姊婚崒姘偓绋棵洪悩璇茬；闁瑰墽绮悡鐔兼煏婵炲灝鍔氭い蹇ｄ簻椤儻顦茬紒澶屾嚀椤曪綁宕归銏㈢獮闁诲繒鍋熼崑鎾诲窗閹烘鈷戠紓浣癸供濞堟梹绻涚拠褏鐣辨い鏇秮楠炴劖鎯旈～顓熷攭闂備浇顫夐鏍闯椤曗偓瀹曟洘绻濋崶銊у帾?
// 闂傚倸鍊风欢锟犲礈濮樿泛绠插〒姘ｅ亾闁诡垰鐭傞幃娆擃敆閸屾鐏冮梺纭呭亹鐞涖儵宕滃┑瀣闁告挆鍕瀾闂佺厧澹婇崜娆撴倶椤旂晫绠鹃柡澶嬪焾濡偓閻庤娲橀〃鍛存偩閻戣棄鐐婇柕濞у嫭顔忕紓鍌氬€烽悞锔剧矙閹烘纾块柟鎯版缁犳牠鏌￠崶鈺佹灁闁崇懓绉归弻宥夊煛娴ｅ憡娈ㄧ紓浣介哺閻楁洟婀侀梺缁橈供閸犳牠宕濆鎵佸亾濞堝灝鏋ら柛蹇旓耿楠炲啯绂掔€ｎ€晠鏌曢崼婵囩┛濠㈣锕㈠娲川婵犲倸顫岀紓浣割槸閻栧ジ鎮伴鈧畷鎯邦檨婵為棿鍗抽弻鏇㈠醇濠靛浂妫ら梺閫炲苯澧婚柛銊ゅ嵆椤㈡艾鈻庨幘瀛樺劒闁荤喐鐟ョ€氼噣寮抽悩缁樷拺闁告稑锕﹂幊鍐煕婵犲倻绉虹€殿喗濞婇幃銏ゅ礂閸忓吋鐝梻浣稿閸嬪懐鍒掓惔銊ョ厴闁圭儤鍤氶悷閭︾叆闁告劏鏅滃畷宕囩磽娴ｇ懓鏁惧┑鈥虫喘閸┾偓妞ゆ帊鑳堕埊鏇㈡煥濮樿埖鐓欓柧姘€稿畵鍡欌偓娈垮枙缁瑩寮幘缁樺亹闂傚牊绋撻悡鎴︽⒒娴ｇ懓顕滅紒瀣灴钘濇い鎾卞灩閻?

export function buildRoadHeightfieldBodies(params: RoadHeightfieldBuildParams): RoadHeightfieldBodiesEntry | null {
	const snapshot = collectRoadHeightfieldTileDescriptors(params)
	if (!snapshot) {
		return null
	}
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode = null,
		createBody,
	} = params

	roadObject.updateMatrixWorld(true)

	const bodies: CANNON.Body[] = []
	for (const tile of snapshot.tiles) {
		if (!tile.shapeDefinition) {
			continue
		}
		const tileObject = new THREE.Object3D()
		tileObject.rotation.set(0, tile.yaw, 0)
		tileObject.position.set(tile.position[0], tile.position[1], tile.position[2])
		roadObject.add(tileObject)
		tileObject.updateMatrixWorld(true)
		const bodyResult = createBody(snapshot.surfaceNode, rigidbodyComponent, tile.shapeDefinition, tileObject)
		roadObject.remove(tileObject)
		if (bodyResult?.body) {
			;(bodyResult.body as CANNON.Body & { name?: string }).name = `road-tile:${roadNode.id}:curve:${tile.curveIndex}:tile:${tile.tileIndex}`
			bodies.push(bodyResult.body)
		}
	}

	if (snapshot.boundaryWallEnabled) {
		const boundaryBodyResult = createBody(roadNode, rigidbodyComponent, null, roadObject)
		if (boundaryBodyResult?.body) {
			bodies.push(boundaryBodyResult.body)
		}
	}

	if (!bodies.length) {
		return null
	}

	const signature = buildRoadHeightfieldSignature({
		definition: roadNode.dynamicMesh as RoadDynamicMesh,
		roadNode,
		groundNode,
		groundSignature: snapshot.groundSignature,
		roadWidth: snapshot.roadWidth,
		collisionWidth: snapshot.collisionWidth,
		samplingDensityFactor: snapshot.samplingDensityFactor,
		smoothingStrengthFactor: snapshot.smoothingStrengthFactor,
		minClearance: snapshot.minClearance,
		junctionSmoothing: snapshot.junctionSmoothing,
		elementSize: snapshot.elementSize,
		desiredTileLength: snapshot.desiredTileLength,
		bodyCount: bodies.length,
		heightHash: snapshot.heightHash,
		layoutHash: snapshot.layoutHash,
		boundaryWallEnabled: snapshot.boundaryWallEnabled,
		boundaryWallProps: snapshot.boundaryWallProps,
	})

	return { signature, bodies }
}

const ROAD_SURFACE_Y_OFFSET = 0.01
const ROAD_EPSILON = 1e-6
const ROAD_MIN_DIVISIONS = 4
const ROAD_MAX_DIVISIONS = 256
const ROAD_DIVISION_DENSITY = 8

const ROAD_HEIGHT_SMOOTHING_MIN_PASSES = 3
const ROAD_HEIGHT_SMOOTHING_MAX_PASSES = 12

const ROAD_HEIGHT_SLOPE_MAX_GRADE = 0.8
const ROAD_HEIGHT_SLOPE_MIN_DELTA_Y = 0.03
const ROAD_COLLISION_TILE_OVERLAP_METERS = 0.5
const ROAD_HEIGHTFIELD_MIN_ROWS = 24
const ROAD_HEIGHTFIELD_MAX_ROWS = 128
const ROAD_HEIGHTFIELD_MIN_TILE_LENGTH = 4
const ROAD_HEIGHTFIELD_MAX_TILE_LENGTH = 32
const ROAD_HEIGHTFIELD_DEFAULT_TILE_LENGTH = 12
const ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL = 0.18
const ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL = 0.18
const ROAD_RECTANGULAR_MAX_HEIGHT_RANGE = 0.12
const ROAD_RECTANGULAR_MIN_THICKNESS = 0.08
const ROAD_RECTANGULAR_MAX_THICKNESS = 0.28

// Road collision uses tiled heightfields exclusively.
// Tile length is adaptively reduced on bends to keep chord approximation tight.
const ROAD_TILE_MAX_HEADING_DELTA_RAD = (8 * Math.PI) / 180

function normalizeAngleRad(angle: number): number {
	if (!Number.isFinite(angle)) {
		return 0
	}
	let value = angle
	while (value > Math.PI) {
		value -= Math.PI * 2
	}
	while (value < -Math.PI) {
		value += Math.PI * 2
	}
	return value
}

function computeHeadingDeltaRad(curve: THREE.Curve<THREE.Vector3>, startU: number, endU: number): number {
	const t0 = curve.getTangent(Math.max(0, Math.min(1, startU)))
	t0.y = 0
	const t1 = curve.getTangent(Math.max(0, Math.min(1, endU)))
	t1.y = 0
	const a0 = Math.atan2(t0.x, t0.z)
	const a1 = Math.atan2(t1.x, t1.z)
	return Math.abs(normalizeAngleRad(a1 - a0))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
	return Math.max(min, Math.min(max, numeric))
}

function lerpNumber(start: number, end: number, t: number): number {
	return start + (end - start) * t
}

function computeCurveGeometryDetailScore(curve: THREE.Curve<THREE.Vector3>, length: number): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
		return 0
	}
	const sampleCount = Math.max(4, Math.min(16, Math.ceil(length / 2)))
	const tangent = new THREE.Vector3()
	let previousHeading = 0
	let hasPreviousHeading = false
	let totalHeadingDelta = 0
	let maxHeadingDelta = 0
	for (let i = 0; i <= sampleCount; i += 1) {
		const u = i / sampleCount
		curve.getTangent(u, tangent)
		tangent.y = 0
		const heading = Math.atan2(tangent.x, tangent.z)
		if (hasPreviousHeading) {
			const delta = Math.abs(normalizeAngleRad(heading - previousHeading))
			totalHeadingDelta += delta
			maxHeadingDelta = Math.max(maxHeadingDelta, delta)
		}
		previousHeading = heading
		hasPreviousHeading = true
	}
	const totalTurnScore = Math.max(0, Math.min(1, totalHeadingDelta / Math.PI))
	const sharpTurnScore = Math.max(0, Math.min(1, maxHeadingDelta / ((10 * Math.PI) / 180)))
	return Math.max(0, Math.min(1, totalTurnScore * 0.65 + sharpTurnScore * 0.35))
}

function computeRoadHeightDetailScore(values: number[], length: number): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON || values.length < 3) {
		return 0
	}
	const step = length / Math.max(1, values.length - 1)
	if (!Number.isFinite(step) || step <= ROAD_EPSILON) {
		return 0
	}
	let maxSlope = 0
	let maxDeltaSlope = 0
	for (let i = 1; i < values.length; i += 1) {
		const current = Number.isFinite(values[i]!) ? values[i]! : 0
		const previous = Number.isFinite(values[i - 1]!) ? values[i - 1]! : 0
		const slope = Math.abs(current - previous) / step
		maxSlope = Math.max(maxSlope, slope)
		if (i >= 2) {
			const beforePrevious = Number.isFinite(values[i - 2]!) ? values[i - 2]! : 0
			const previousSlope = Math.abs(previous - beforePrevious) / step
			maxDeltaSlope = Math.max(maxDeltaSlope, Math.abs(slope - previousSlope))
		}
	}
	const slopeScore = Math.max(0, Math.min(1, maxSlope / ROAD_HEIGHT_SLOPE_MAX_GRADE))
	const roughnessScore = Math.max(0, Math.min(1, maxDeltaSlope / Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, 0.15)))
	return Math.max(0, Math.min(1, slopeScore * 0.8 + roughnessScore * 0.2))
}

function computeRoadHeightRange(values: number[]): number {
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (const value of values) {
		const numeric = Number.isFinite(value) ? value : 0
		min = Math.min(min, numeric)
		max = Math.max(max, numeric)
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

function computeRoadHeightRangeForSpan(values: number[], startIndex: number, endIndex: number): number {
	const start = Math.max(0, Math.min(values.length, Math.trunc(startIndex)))
	const end = Math.max(start, Math.min(values.length, Math.trunc(endIndex)))
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (let i = start; i < end; i += 1) {
		const numeric = Number.isFinite(values[i]!) ? values[i]! : 0
		min = Math.min(min, numeric)
		max = Math.max(max, numeric)
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

type RoadCollisionSpan = {
	startIndex: number
	endIndex: number
	kind: 'box' | 'heightfield'
}

function collectRoadCollisionSpans(
	curve: THREE.Curve<THREE.Vector3>,
	divisions: number,
	heights: number[],
): RoadCollisionSpan[] {
	if (!(divisions > 0)) {
		return []
	}
	const intervalKinds: Array<'box' | 'heightfield'> = []
	for (let i = 0; i < divisions; i += 1) {
		const startU = i / divisions
		const endU = (i + 1) / divisions
		const geometryDetail = computeHeadingDeltaRad(curve, startU, endU)
		const heightRange = computeRoadHeightRangeForSpan(heights, Math.max(0, i - 1), Math.min(heights.length, i + 2))
		const heightDetail = Math.max(0, Math.min(1, heightRange / Math.max(ROAD_RECTANGULAR_MAX_HEIGHT_RANGE, 1e-6)))
		const isBoxCandidate =
			geometryDetail <= ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL &&
			geometryDetail <= ROAD_TILE_MAX_HEADING_DELTA_RAD * 0.75 &&
			heightDetail <= ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL &&
			heightRange <= ROAD_RECTANGULAR_MAX_HEIGHT_RANGE * 0.5
		intervalKinds.push(isBoxCandidate ? 'box' : 'heightfield')
	}
	const spans: RoadCollisionSpan[] = []
	let startIndex = 0
	while (startIndex < divisions) {
		const kind = intervalKinds[startIndex]!
		let endIndex = startIndex + 1
		while (endIndex < divisions && intervalKinds[endIndex] === kind) {
			endIndex += 1
		}
		if (kind === 'box' && endIndex - startIndex < 2) {
			spans.push({ startIndex, endIndex, kind: 'heightfield' })
		} else {
			spans.push({ startIndex, endIndex, kind })
		}
		startIndex = endIndex
	}
	return spans
}
function computeRoadDivisions(length: number, samplingDensityFactor = 1.0): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
		return 0
	}
	const densityFactor = clampNumber(samplingDensityFactor, 0.1, 10, 1.0)
	return Math.max(
		ROAD_MIN_DIVISIONS,
		Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY * densityFactor)),
	)
}

function computeCornerMinSegments(junctionSmoothing = 0): number {
	const smoothing = clampNumber(junctionSmoothing, 0, 1, 0)
	const suggested = Math.round(12 + 12 * smoothing)
	return Math.max(6, Math.min(48, suggested))
}

function computeRoadDivisionsForCurve(
	curve: THREE.Curve<THREE.Vector3>,
	length: number,
	samplingDensityFactor = 1.0,
	junctionSmoothing = 0,
	geometryDetail = 0,
): number {
	let divisions = computeRoadDivisions(length, samplingDensityFactor)
	if (!(divisions > 0)) {
		return 0
	}
	const geometryScale = lerpNumber(0.3, 0.85, Math.max(0, Math.min(1, geometryDetail)))
	divisions = Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, Math.round(divisions * geometryScale)))
	const curves = (curve as any)?.curves
	if (!Array.isArray(curves) || !curves.length) {
		return divisions
	}
	const cornerMinSegments = computeCornerMinSegments(junctionSmoothing)
	for (const segment of curves as Array<THREE.Curve<THREE.Vector3>>) {
		const isQuadratic = Boolean((segment as any)?.isQuadraticBezierCurve3)
		if (!isQuadratic) {
			continue
		}
		const cornerLength = segment.getLength()
		if (!Number.isFinite(cornerLength) || cornerLength <= ROAD_EPSILON) {
			continue
		}
		const requiredTotal = Math.ceil((cornerMinSegments * length) / cornerLength)
		if (Number.isFinite(requiredTotal)) {
			divisions = Math.max(divisions, requiredTotal)
		}
	}
	return Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, divisions))
}

function computeHeightSmoothingPasses(divisions: number, strengthFactor = 1.0): number {
	if (!Number.isFinite(divisions) || divisions <= 0) {
		return ROAD_HEIGHT_SMOOTHING_MIN_PASSES
	}
	const factor = clampNumber(strengthFactor, 0.1, 5, 1.0)
	const suggested = Math.round((divisions / 12) * factor)
	return Math.max(ROAD_HEIGHT_SMOOTHING_MIN_PASSES, Math.min(ROAD_HEIGHT_SMOOTHING_MAX_PASSES, suggested))
}

function smoothHeightSeries(values: number[], passes: number, minimums: number[]): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values.slice()
	}
	const iterations = Math.max(0, Math.min(12, Math.trunc(passes)))
	if (iterations === 0) {
		return values.slice()
	}
	let working = values.slice()
	for (let pass = 0; pass < iterations; pass += 1) {
		const next = working.slice()
		for (let i = 1; i < count - 1; i += 1) {
			const smoothed = (working[i - 1]! + working[i]! + working[i + 1]!) / 3
			next[i] = Math.max(minimums[i]!, smoothed)
		}
		next[0] = Math.max(minimums[0]!, next[0]!)
		next[count - 1] = Math.max(minimums[count - 1]!, next[count - 1]!)
		working = next
	}
	return working
}

function clampHeightSeriesSlope(values: number[], minimums: number[], maxDeltaY: number): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values.slice()
	}
	const delta = Number.isFinite(maxDeltaY) ? Math.max(0, maxDeltaY) : 0
	if (delta <= 0) {
		return values.slice()
	}
	const working = values.slice()
	for (let i = 1; i < count; i += 1) {
		working[i] = Math.max(minimums[i]!, Math.min(working[i]!, working[i - 1]! + delta))
	}
	for (let i = count - 2; i >= 0; i -= 1) {
		working[i] = Math.max(minimums[i]!, Math.min(working[i]!, working[i + 1]! + delta))
	}
	return working
}

// Removed unused SanitizedRoadSegment type
// Removed unused road graph helpers: RoadBuildData, sanitizeRoadVertices, buildAdjacencyMap, collectRoadPaths
// Removed unused `collectRoadBuildData` helper.

type RoadCurveDescriptor = { curve: THREE.Curve<THREE.Vector3> }

function buildRoadCurvesFromGraph(smoothing: number, graph: RoadGraph): RoadCurveDescriptor[] {
	const junctionSmoothing = Math.max(0, Math.min(1, Number.isFinite(smoothing) ? smoothing : 0))
	const curves: RoadCurveDescriptor[] = []
	for (const edge of graph.edges) {
		const points = edge.indices
			.map((idx) => graph.vertices[idx] ?? null)
			.filter((p): p is THREE.Vector3 => Boolean(p))
		if (points.length < 2) {
			continue
		}
		curves.push({ curve: buildRoadCornerBezierCurvePath(points, edge.closed && points.length >= 3, junctionSmoothing) })
	}
	return curves
}

function collectRoadCurveSubsegments(curve: THREE.Curve<THREE.Vector3>): THREE.Curve<THREE.Vector3>[] {
	const subcurves = (curve as any)?.curves
	if (!Array.isArray(subcurves) || !subcurves.length) {
		return [curve]
	}
	return subcurves.filter((segment): segment is THREE.Curve<THREE.Vector3> => Boolean(segment))
}

// createRoadCurve removed (unused)

// Removed unused `buildRoadCurves` wrapper.

type RoadCenterlineHeightSeriesParams = {
	curve: THREE.Curve<THREE.Vector3>
	divisions: number
	heightSampler: (x: number, z: number) => number
	minClearance: number
	smoothingStrengthFactor: number
	smooth: boolean
}

function buildRoadCenterlineHeightSeries({
	curve,
	divisions,
	heightSampler,
	minClearance,
	smoothingStrengthFactor,
	smooth,
}: RoadCenterlineHeightSeriesParams): number[] {
	const values: number[] = []
	const minimums: number[] = []
	const center = new THREE.Vector3()
	for (let i = 0; i <= divisions; i += 1) {
		const u = i / divisions
		curve.getPoint(u, center)
		const hCenter = heightSampler(center.x, center.z)
		const baseHeight = Number.isFinite(hCenter) ? hCenter : 0
		const minHeight = baseHeight + Math.max(0, minClearance)
		const surface = minHeight + ROAD_SURFACE_Y_OFFSET
		values.push(surface)
		minimums.push(surface)
	}
	if (!smooth) {
		return values
	}
	const passes = computeHeightSmoothingPasses(divisions, smoothingStrengthFactor)
	let smoothed = smoothHeightSeries(values, passes, minimums)
	const stepDistance = curve.getLength() / divisions
	const maxDeltaY = Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, stepDistance * ROAD_HEIGHT_SLOPE_MAX_GRADE)
	smoothed = clampHeightSeriesSlope(smoothed, minimums, maxDeltaY)
	return smoothed
}

type HeightfieldFromSeriesParams = {
	startIndex: number
	endIndex: number
	rows: number
	elementSize: number
	roadWidth: number
	heights: number[]
}

type RoadRectangularTileShapeParams = {
	roadWidth: number
	length: number
	heights: number[]
}

function buildRoadRectangularTileShapeFromSeries({
	roadWidth,
	length,
	heights,
}: RoadRectangularTileShapeParams): RigidbodyPhysicsShape | null {
	if (!(roadWidth > ROAD_EPSILON) || !(length > ROAD_EPSILON) || heights.length < 2) {
		return null
	}
	const heightRange = computeRoadHeightRange(heights)
	if (!Number.isFinite(heightRange) || heightRange > ROAD_RECTANGULAR_MAX_HEIGHT_RANGE) {
		return null
	}
	const thickness = Math.max(
		ROAD_RECTANGULAR_MIN_THICKNESS,
		Math.min(
			ROAD_RECTANGULAR_MAX_THICKNESS,
			Math.max(ROAD_SURFACE_Y_OFFSET * 4, heightRange * 2 + 0.04),
		),
	)
	return {
		kind: 'box',
		halfExtents: [Math.max(1e-4, roadWidth * 0.5), Math.max(1e-4, thickness * 0.5), Math.max(1e-4, length * 0.5)],
		offset: [0, 0, 0],
		applyScale: false,
	}
}

function buildHeightfieldShapeFromSeries({
	startIndex,
	endIndex,
	rows,
	elementSize,
	roadWidth,
	heights,
}: HeightfieldFromSeriesParams): Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }> | null {
	const span = endIndex - startIndex
	if (span <= 0) {
		return null
	}
	const overlapRows = Math.max(1, Math.ceil(ROAD_COLLISION_TILE_OVERLAP_METERS / elementSize))
	const pointsX = Math.max(2, Math.ceil(Math.max(roadWidth, elementSize) / elementSize) + 1)
	const pointsZ = rows + 1 + overlapRows * 2
	if (pointsX < 2 || pointsZ < 2) {
		return null
	}
	const width = Math.max(1e-4, (pointsX - 1) * elementSize)
	const depth = Math.max(1e-4, (pointsZ - 1) * elementSize)
	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const matrix: number[][] = []
	for (let col = 0; col < pointsX; col += 1) {
		const columnValues: number[] = []
		for (let row = pointsZ - 1; row >= 0; row -= 1) {
			const innerRows = Math.max(1, pointsZ - 1 - overlapRows * 2)
			const uAlong = pointsZ > 1
				? Math.max(0, Math.min(1, (row - overlapRows) / innerRows))
				: 0
			const indexFloat = startIndex + uAlong * span
			const i0 = Math.max(0, Math.min(heights.length - 1, Math.floor(indexFloat)))
			const i1 = Math.max(0, Math.min(heights.length - 1, i0 + 1))
			const frac = indexFloat - i0
			const h0 = heights[i0] ?? 0
			const h1 = heights[i1] ?? h0
			const height = h0 + (h1 - h0) * frac
			columnValues.push(Number.isFinite(height) ? height : 0)
		}
		matrix.push(columnValues)
	}
	return {
		kind: 'heightfield',
		matrix,
		elementSize,
		width,
		depth,
		offset: [-halfWidth, -halfDepth, 0],
		applyScale: false,
	}
}

function buildRoadHeightfieldSignature(params: {
	definition: RoadDynamicMesh
	roadNode: SceneNode
	groundNode?: SceneNode | null
	groundSignature: string
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	elementSize: number
	desiredTileLength: number
	bodyCount: number
	heightHash: number
	layoutHash: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}): string {
	const roadPosition = (params.roadNode.position as any) ?? {}
	const roadRotation = (params.roadNode.rotation as any) ?? {}
	const groundPosition = (params.groundNode?.position as any) ?? {}
	const rx = typeof roadPosition.x === 'number' && Number.isFinite(roadPosition.x) ? roadPosition.x : 0
	const ry = typeof roadPosition.y === 'number' && Number.isFinite(roadPosition.y) ? roadPosition.y : 0
	const rz = typeof roadPosition.z === 'number' && Number.isFinite(roadPosition.z) ? roadPosition.z : 0
	const yaw = typeof roadRotation.y === 'number' && Number.isFinite(roadRotation.y) ? roadRotation.y : 0
	const gx = typeof groundPosition.x === 'number' && Number.isFinite(groundPosition.x) ? groundPosition.x : 0
	const gy = typeof groundPosition.y === 'number' && Number.isFinite(groundPosition.y) ? groundPosition.y : 0
	const gz = typeof groundPosition.z === 'number' && Number.isFinite(groundPosition.z) ? groundPosition.z : 0
	const verticesCount = Array.isArray(params.definition.vertices) ? params.definition.vertices.length : 0
	const segmentsCount = Array.isArray(params.definition.segments) ? params.definition.segments.length : 0
	return [
		`road:${params.roadNode.id}`,
		`frame:chord`,
		`v:${verticesCount}`,
		`s:${segmentsCount}`,
		`w:${Math.round(params.roadWidth * 1000)}`,
		`cw:${Math.round(params.collisionWidth * 1000)}`,
		`jd:${Math.round(params.junctionSmoothing * 1000)}`,
		`sd:${Math.round(params.samplingDensityFactor * 1000)}`,
		`ss:${Math.round(params.smoothingStrengthFactor * 1000)}`,
		`mc:${Math.round(params.minClearance * 1000)}`,
		`tile:${Math.round(params.desiredTileLength * 1000)}`,
		`es:${Math.round(params.elementSize * 1000)}`,
		`b:${params.bodyCount}`,
		`rh:${params.heightHash.toString(16)}`,
		`lh:${params.layoutHash.toString(16)}`,
		`bw:${params.boundaryWallEnabled ? 1 : 0}`,
		`bwh:${Math.round((params.boundaryWallProps?.height ?? 0) * 1000)}`,
		`bwt:${Math.round((params.boundaryWallProps?.thickness ?? 0) * 1000)}`,
		`bwo:${Math.round((params.boundaryWallProps?.offset ?? 0) * 1000)}`,
		`rp:${Math.round(rx * 1000)},${Math.round(ry * 1000)},${Math.round(rz * 1000)}`,
		`ry:${Math.round(yaw * 1000)}`,
		`gp:${Math.round(gx * 1000)},${Math.round(gy * 1000)},${Math.round(gz * 1000)}`,
		`gs:${params.groundSignature}`,
	].join('|')
}

